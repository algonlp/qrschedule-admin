import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Service-level tests for the WhatsApp template management rules (feature spec
 * S34). A tiny in-memory Supabase double stands in for the shared DB and the
 * Meta client is stubbed, so these lock behaviour without a network or a
 * database:
 *   • sync refreshes Meta fields and PRESERVES assignment rows
 *   • an incompatible template cannot be assigned
 *   • a non-APPROVED template cannot be activated
 *   • replacing an assignment keeps the old template row intact
 *   • emergency stop deactivates every assignment for a template
 */

const h = vi.hoisted(() => {
  type R = Record<string, unknown>;
  const templates = new Map<string, R>();
  const assignments = new Map<string, R>();
  const logs = new Map<string, R>();
  const plans = new Map<string, R>();
  const businesses = new Map<string, R>();
  const metaTemplatesFixture = vi.fn();
  /** table names the fake should pretend do not exist (PGRST205) */
  const missingTables = new Set<string>();

  const clone = (r: R): R => JSON.parse(JSON.stringify(r)) as R;
  const idOf = (r: R): string => String(r.id);
  const missingErr = { code: "PGRST205", message: "Could not find the table in the schema cache" };

  const makeTable = (store: Map<string, R>, tableName: string) => {
    const gone = () => missingTables.has(tableName);
    const valueAt = (row: R, col: string): unknown => {
      const m = col.match(/^payload->>(.+)$/);
      if (m) return (row.payload as R | undefined)?.[m[1]];
      return row[col];
    };
    const makeBuilder = (initial: R[]) => {
      let filtered = initial;
      const builder = {
        eq(col: string, val: unknown) {
          filtered = filtered.filter((r) => valueAt(r, col) === val);
          return builder;
        },
        filter(col: string, _op: string, val: unknown) {
          filtered = filtered.filter((r) => valueAt(r, col) === val);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () =>
          gone() ? { data: null, error: missingErr } : { data: filtered[0] ?? null, error: null },
        single: async () => ({
          data: filtered[0] ?? null,
          error: filtered[0] ? null : { message: "no rows" },
        }),
        then: (resolve: (v: { data: R[] | null; error: unknown }) => unknown) =>
          resolve(gone() ? { data: null, error: missingErr } : { data: filtered, error: null }),
      };
      return builder;
    };
    return {
      select: () => makeBuilder([...store.values()].map(clone)),
      async upsert(rows: R | R[]) {
        for (const r of Array.isArray(rows) ? rows : [rows]) store.set(idOf(r), clone(r));
        return { data: null, error: null };
      },
      update(patch: R) {
        return {
          async eq(col: string, val: unknown) {
            for (const [key, row] of store) {
              if (row[col] === val) store.set(key, { ...row, ...clone(patch) });
            }
            return { data: null, error: null };
          },
        };
      },
    };
  };

  const supabase = {
    from(table: string) {
      if (table === "whatsapp_template_records") return makeTable(templates, table);
      if (table === "whatsapp_template_assignment_records") return makeTable(assignments, table);
      if (table === "sms_log_records") return makeTable(logs, table);
      if (table === "subscription_plan_records") return makeTable(plans, table);
      if (table === "businesses") return makeTable(businesses, table);
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { templates, assignments, logs, plans, businesses, metaTemplatesFixture, missingTables, supabase };
});

const { templates, assignments, logs, plans, businesses, metaTemplatesFixture, missingTables } = h;

// Live plan list the matrix / assign-guard read from subscription_plan_records.
for (const [i, key] of ["lite", "growth", "professional", "multi_branch"].entries()) {
  plans.set(key, { plan_key: key, is_active: true, display_order: i, payload: { name: key } });
}

// Salons for salon-specific assignments.
businesses.set("biz_1", { id: "biz_1", business_name: "Glow Studio" });
businesses.set("biz_2", { id: "biz_2", business_name: "Sharp Cuts" });

vi.mock("@/lib/supabase", () => ({ supabase: h.supabase }));
vi.mock("@/lib/whatsapp-meta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp-meta")>();
  return {
    ...actual,
    fetchMetaMessageTemplates: () => h.metaTemplatesFixture(),
    submitMetaMessageTemplate: vi.fn(async () => ({ id: "meta_new_1", status: "PENDING", category: "UTILITY" })),
  };
});

import {
  assignTemplate,
  listTemplates,
  RegistryNotProvisionedError,
  setAssignmentActive,
  stopTemplate,
  submitNewVersion,
  syncFromMeta,
  TemplateActionError,
} from "./whatsapp-template-service";
import { templateRecordId, assignmentRecordId, WHATSAPP_PURPOSES } from "./whatsapp-templates";

const seedTemplate = (name: string, status: string, variableKeys: string[], lang = "en_US") => {
  templates.set(templateRecordId(name, lang), {
    id: templateRecordId(name, lang),
    name,
    language: lang,
    category: "UTILITY",
    meta_status: status,
    meta_template_id: null,
    payload: {
      name,
      language: lang,
      category: "UTILITY",
      body: "body " + variableKeys.map((_, i) => `{{${i + 1}}}`).join(" "),
      buttons: [],
      variables: variableKeys.map((key, i) => ({ position: i + 1, key, label: key })),
    },
  });
};

const seedAssignment = (
  purpose: string,
  templateName: string,
  isActive: boolean,
  plan = "*",
  lang = "en_US",
) => {
  assignments.set(assignmentRecordId(purpose, plan, lang), {
    id: assignmentRecordId(purpose, plan, lang),
    purpose,
    plan_key: plan,
    language: lang,
    template_name: templateName,
    is_active: isActive,
    priority: 0,
    created_by: "seed",
    updated_by: "seed",
    payload: { assignedBy: "seed", assignedAt: "2026-01-01T00:00:00Z" },
  });
};

beforeEach(() => {
  templates.clear();
  assignments.clear();
  logs.clear();
  missingTables.clear();
  metaTemplatesFixture.mockReset();
});

describe("syncFromMeta", () => {
  it("refreshes Meta status without touching assignment rows", async () => {
    seedTemplate("appointment_confirmed", "UNVERIFIED", [
      "businessName",
      "appointmentDateTime",
      "serviceName",
      "bookingReference",
    ]);
    seedAssignment("appointment_confirmed", "appointment_confirmed", true);

    metaTemplatesFixture.mockResolvedValue([
      {
        name: "appointment_confirmed",
        language: "en_US",
        status: "APPROVED",
        category: "UTILITY",
        components: [{ type: "BODY", text: "Hi {{1}} {{2}} {{3}} {{4}}" }],
      },
    ]);

    const result = await syncFromMeta();

    expect(result.statusChanges).toContainEqual({
      name: "appointment_confirmed",
      language: "en_US",
      from: "UNVERIFIED",
      to: "APPROVED",
    });
    expect(templates.get("appointment_confirmed__en_US")!.meta_status).toBe("APPROVED");
    // assignment row untouched
    const a = assignments.get("appointment_confirmed__*__en_US")!;
    expect(a.is_active).toBe(true);
    expect((a.payload as Record<string, unknown>).assignedBy).toBe("seed");
  });

  it("marks a vanished (previously APPROVED) template NOT_FOUND, never deletes it", async () => {
    seedTemplate("old_template", "APPROVED", ["businessName"]);
    metaTemplatesFixture.mockResolvedValue([]);

    const result = await syncFromMeta();

    expect(result.markedNotFound).toContain("old_template (en_US)");
    expect(templates.get("old_template__en_US")!.meta_status).toBe("NOT_FOUND");
  });

  it("leaves an UNVERIFIED seed row untouched when Meta does not list it", async () => {
    seedTemplate("appointment_confirmed", "UNVERIFIED", ["businessName"]);
    metaTemplatesFixture.mockResolvedValue([
      {
        name: "growth_appointment_confirmed_v1",
        language: "en",
        status: "APPROVED",
        category: "UTILITY",
        components: [{ type: "BODY", text: "Hi {{1}}" }],
      },
    ]);

    const result = await syncFromMeta();

    expect(templates.get("appointment_confirmed__en_US")!.meta_status).toBe("UNVERIFIED");
    expect(result.markedNotFound).toEqual([]);
    expect(result.added).toContain("growth_appointment_confirmed_v1 (en)");
  });

  it("preserves admin notes across a sync", async () => {
    seedTemplate("promo_percent_off", "APPROVED", ["customerName"]);
    (templates.get("promo_percent_off__en_US")!.payload as Record<string, unknown>).adminNotes = "keep me";
    metaTemplatesFixture.mockResolvedValue([
      {
        name: "promo_percent_off",
        language: "en_US",
        status: "PAUSED",
        category: "MARKETING",
        components: [{ type: "BODY", text: "Hi {{1}}" }],
      },
    ]);

    await syncFromMeta();
    expect(
      (templates.get("promo_percent_off__en_US")!.payload as Record<string, unknown>).adminNotes,
    ).toBe("keep me");
  });
});

describe("assignTemplate", () => {
  it("rejects a template whose variables the flow cannot supply", async () => {
    seedTemplate("bad_tpl", "APPROVED", ["unheard_of_var"]);
    await expect(
      assignTemplate({
        templateId: "bad_tpl__en_US",
        purpose: "appointment_confirmed",
        activate: true,
        actor: "admin@x.com",
      }),
    ).rejects.toBeInstanceOf(TemplateActionError);
  });

  it("assigns but stays INACTIVE when Meta status is not APPROVED", async () => {
    seedTemplate("appt_v2", "PENDING", [
      "businessName",
      "appointmentDateTime",
      "serviceName",
      "bookingReference",
    ]);
    const res = await assignTemplate({
      templateId: "appt_v2__en_US",
      purpose: "appointment_confirmed",
      activate: true,
      actor: "admin@x.com",
    });
    expect(res.isActive).toBe(false);
    expect(res.note).toMatch(/not APPROVED/i);
  });

  it("replaces an existing binding and keeps the old template row intact", async () => {
    seedTemplate("appt_v1", "APPROVED", [
      "businessName",
      "appointmentDateTime",
      "serviceName",
      "bookingReference",
    ]);
    seedTemplate("appt_v2", "APPROVED", [
      "businessName",
      "appointmentDateTime",
      "serviceName",
      "bookingReference",
    ]);
    seedAssignment("appointment_confirmed", "appt_v1", true);

    const res = await assignTemplate({
      templateId: "appt_v2__en_US",
      purpose: "appointment_confirmed",
      activate: true,
      actor: "admin@x.com",
    });

    expect(res.previousTemplateName).toBe("appt_v1");
    expect(res.isActive).toBe(true);
    expect(assignments.get("appointment_confirmed__*__en_US")!.template_name).toBe("appt_v2");
    // old template still there
    expect(templates.get("appt_v1__en_US")).toBeDefined();
  });
});

const APPT4 = ["businessName", "appointmentDateTime", "serviceName", "bookingReference"];

describe("plan-aware assignment", () => {
  it("assigns a template to a specific plan without touching the global row", async () => {
    seedTemplate("growth_appointment_confirmed_v1", "APPROVED", APPT4);
    seedTemplate("appointmnet_confirmation", "APPROVED", APPT4);
    seedAssignment("appointment_confirmed", "appointmnet_confirmation", true, "*");

    const res = await assignTemplate({
      templateId: "growth_appointment_confirmed_v1__en_US",
      purpose: "appointment_confirmed",
      plan: "growth",
      activate: true,
      actor: "a@x.com",
    });

    expect(res.plan).toBe("growth");
    expect(res.isActive).toBe(true);
    expect(assignments.get("appointment_confirmed__growth__en_US")!.template_name).toBe(
      "growth_appointment_confirmed_v1",
    );
    // global row untouched
    expect(assignments.get("appointment_confirmed__*__en_US")!.template_name).toBe(
      "appointmnet_confirmation",
    );
  });

  it("rejects an unknown plan key", async () => {
    seedTemplate("t", "APPROVED", APPT4);
    await expect(
      assignTemplate({
        templateId: "t__en_US",
        purpose: "appointment_confirmed",
        plan: "enterprise_plus",
        actor: "a@x.com",
      }),
    ).rejects.toBeInstanceOf(TemplateActionError);
  });

  it("matrix cell resolves plan -> global -> catalogue fallback", async () => {
    seedTemplate("growth_appointment_confirmed_v1", "APPROVED", APPT4);
    seedTemplate("appointmnet_confirmation", "APPROVED", APPT4);
    seedAssignment("appointment_confirmed", "growth_appointment_confirmed_v1", true, "growth");
    seedAssignment("appointment_confirmed", "appointmnet_confirmation", true, "*");

    const { matrices } = await listTemplates();
    const en = matrices.find((m) => m.language === "en_US")!;
    const cellFor = (purpose: string, plan: string) =>
      en.cells.find((c) => c.purpose === purpose && c.plan === plan)!;

    expect(cellFor("appointment_confirmed", "growth")).toMatchObject({
      resolvedTemplateName: "growth_appointment_confirmed_v1",
      resolvedVia: "plan",
    });
    expect(cellFor("appointment_confirmed", "professional")).toMatchObject({
      resolvedTemplateName: "appointmnet_confirmation",
      resolvedVia: "global",
    });
    expect(cellFor("appointment_rescheduled", "growth")).toMatchObject({
      resolvedTemplateName: "appointment_rescheduled",
      resolvedVia: "fallback",
    });
  });
});

describe("salon-specific assignment", () => {
  it("binds a template to one salon, flat (plan forced to '*'), and reports the salon name", async () => {
    seedTemplate("glow_appointment_confirmed", "APPROVED", APPT4);
    seedAssignment("appointment_confirmed", "appointmnet_confirmation", true, "*");
    seedTemplate("appointmnet_confirmation", "APPROVED", APPT4);

    const res = await assignTemplate({
      templateId: "glow_appointment_confirmed__en_US",
      purpose: "appointment_confirmed",
      businessId: "biz_1",
      plan: "growth", // ignored for a salon binding
      activate: true,
      actor: "a@x.com",
    });

    expect(res.businessId).toBe("biz_1");
    expect(res.salonName).toBe("Glow Studio");
    expect(res.plan).toBe("*");
    expect(res.isActive).toBe(true);
    expect(assignments.get("appointment_confirmed__*__en_US__b_biz_1")!.template_name).toBe(
      "glow_appointment_confirmed",
    );
    // the global row is untouched
    expect(assignments.get("appointment_confirmed__*__en_US")!.template_name).toBe(
      "appointmnet_confirmation",
    );
  });

  it("rejects an unknown salon id", async () => {
    seedTemplate("t", "APPROVED", APPT4);
    await expect(
      assignTemplate({
        templateId: "t__en_US",
        purpose: "appointment_confirmed",
        businessId: "biz_nope",
        actor: "a@x.com",
      }),
    ).rejects.toBeInstanceOf(TemplateActionError);
  });

  it("surfaces the salon assignment in listTemplates with a salon name", async () => {
    seedTemplate("glow_appointment_confirmed", "APPROVED", APPT4);
    assignments.set("appointment_confirmed__*__en_US__b_biz_1", {
      id: "appointment_confirmed__*__en_US__b_biz_1",
      purpose: "appointment_confirmed",
      plan_key: "*",
      business_id: "biz_1",
      language: "en_US",
      template_name: "glow_appointment_confirmed",
      is_active: true,
      priority: 0,
      created_by: "seed",
      updated_by: "seed",
      payload: {},
    });

    const { templates: views } = await listTemplates();
    const tpl = views.find((t) => t.name === "glow_appointment_confirmed")!;
    expect(tpl.assignedTo[0]).toMatchObject({ businessId: "biz_1", salonName: "Glow Studio" });
  });
});

describe("setAssignmentActive", () => {
  it("cannot activate a binding on a PENDING template", async () => {
    seedTemplate("appt_v2", "PENDING", APPT4);
    seedAssignment("appointment_confirmed", "appt_v2", false, "growth");

    await expect(
      setAssignmentActive({
        purpose: "appointment_confirmed",
        plan: "growth",
        active: true,
        actor: "a@x.com",
      }),
    ).rejects.toThrow(/not APPROVED/i);
  });

  it("deactivate always succeeds and flips the flag for that plan only", async () => {
    seedTemplate("appt_v1", "APPROVED", APPT4);
    seedAssignment("appointment_confirmed", "appt_v1", true, "growth");
    seedAssignment("appointment_confirmed", "appt_v1", true, "*");

    const res = await setAssignmentActive({
      purpose: "appointment_confirmed",
      plan: "growth",
      active: false,
      actor: "a@x.com",
    });
    expect(res.isActive).toBe(false);
    expect(assignments.get("appointment_confirmed__growth__en_US")!.is_active).toBe(false);
    expect(assignments.get("appointment_confirmed__*__en_US")!.is_active).toBe(true);
  });
});

describe("stopTemplate", () => {
  it("deactivates every assignment that points at the template, across plans", async () => {
    seedTemplate("promo_percent_off", "APPROVED", ["customerName", "businessName", "discountLabel", "serviceName"]);
    seedAssignment("campaign_percent_off", "promo_percent_off", true, "growth");
    seedAssignment("campaign_percent_off", "promo_percent_off", true, "*");

    const res = await stopTemplate({ templateId: "promo_percent_off__en_US", actor: "a@x.com" });

    expect(res.affectedPurposes.map((p) => `${p.purpose}/${p.plan}`).sort()).toEqual([
      "campaign_percent_off/*",
      "campaign_percent_off/growth",
    ]);
    expect(assignments.get("campaign_percent_off__growth__en_US")!.is_active).toBe(false);
    expect(assignments.get("campaign_percent_off__*__en_US")!.is_active).toBe(false);
  });
});

describe("listTemplates", () => {
  it("derives qrStatus and builds a matrix per language", async () => {
    seedTemplate("appointment_confirmed", "APPROVED", APPT4);
    seedAssignment("appointment_confirmed", "appointment_confirmed", true, "*");

    const { templates: views, matrices } = await listTemplates();
    const tpl = views.find((t) => t.name === "appointment_confirmed")!;
    expect(tpl.qrStatus).toBe("active");

    const en = matrices.find((m) => m.language === "en_US")!;
    const confirmedGlobal = en.cells.find(
      (c) => c.purpose === "appointment_confirmed" && c.plan === "*",
    )!;
    expect(confirmedGlobal.resolvedVia).toBe("global");
    expect(confirmedGlobal.resolvedTemplateName).toBe("appointment_confirmed");

    const reschedGlobal = en.cells.find(
      (c) => c.purpose === "appointment_rescheduled" && c.plan === "*",
    )!;
    expect(reschedGlobal.resolvedVia).toBe("fallback");
  });

  it("degrades to provisioned:false (not an error) when the registry tables do not exist", async () => {
    missingTables.add("whatsapp_template_records");
    missingTables.add("whatsapp_template_assignment_records");

    const result = await listTemplates();

    expect(result.provisioned).toBe(false);
    expect(result.templates).toEqual([]);
    // an empty matrix is still returned so the page can render its setup notice
    expect(result.matrices[0].cells.length).toBe(
      WHATSAPP_PURPOSES.length * (result.matrices[0].plans.length),
    );
  });
});

describe("registry-not-provisioned", () => {
  it("syncFromMeta surfaces RegistryNotProvisionedError so the route can 409", async () => {
    missingTables.add("whatsapp_template_records");
    metaTemplatesFixture.mockResolvedValue([]);
    await expect(syncFromMeta()).rejects.toBeInstanceOf(RegistryNotProvisionedError);
  });

  it("assignTemplate surfaces RegistryNotProvisionedError", async () => {
    missingTables.add("whatsapp_template_records");
    await expect(
      assignTemplate({
        templateId: "x__en_US",
        purpose: "appointment_confirmed",
        actor: "a@x.com",
      }),
    ).rejects.toBeInstanceOf(RegistryNotProvisionedError);
  });
});

describe("submitNewVersion", () => {
  it("creates a PENDING local record via Meta and never marks it active", async () => {
    const res = await submitNewVersion({
      name: "appointment_confirmed_v2",
      category: "UTILITY",
      body: "Hi {{1}} at {{2}}",
      actor: "a@x.com",
    });
    expect(res.metaStatus).toBe("PENDING");
    const row = templates.get("appointment_confirmed_v2__en_US")!;
    expect(row.meta_status).toBe("PENDING");
    expect((row.payload as Record<string, unknown>).createdVia).toBe("admin-submit");
  });

  it("refuses to reuse an existing local template name", async () => {
    seedTemplate("appointment_confirmed", "APPROVED", ["businessName"]);
    await expect(
      submitNewVersion({
        name: "appointment_confirmed",
        category: "UTILITY",
        body: "x {{1}}",
        actor: "a@x.com",
      }),
    ).rejects.toBeInstanceOf(TemplateActionError);
  });
});
