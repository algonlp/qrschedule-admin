/**
 * WhatsApp template management service — the one place the Admin Panel routes
 * go through to read and mutate the template registry.
 *
 * Tables (shared Supabase DB, defined in bookmysalon/supabase/schema.sql):
 *   whatsapp_template_records            — Meta-owned template data
 *   whatsapp_template_assignment_records — QR Schedule purpose bindings
 *
 * Hard rules enforced here:
 *   • "Sync from Meta" only ever writes Meta-owned fields on
 *     whatsapp_template_records. It never touches an assignment row and never
 *     deletes a record (a vanished template becomes meta_status NOT_FOUND).
 *   • A template can only be ACTIVATED for a purpose when Meta status = APPROVED
 *     and every template variable is suppliable by that purpose's flow.
 *   • One active template per (purpose, language). Assigning a new one replaces
 *     the binding; the old template row is left intact.
 *   • Deactivating / stopping in QR Schedule never calls Meta.
 */

import { supabase } from "@/lib/supabase";
import {
  GLOBAL_BUSINESS,
  WHATSAPP_PURPOSES,
  assignmentRecordId,
  checkCompatibility,
  deriveQrStatus,
  isMetaStatusSendable,
  languageAliases,
  purposeByKey,
  templateRecordId,
  type CompatibilityReport,
  type QrTemplateStatus,
  type WhatsappPurpose,
  type WhatsappTemplatePayload,
} from "@/lib/whatsapp-templates";
import {
  fetchMetaMessageTemplates,
  normalizeMetaTemplate,
  submitMetaMessageTemplate,
  type SubmitTemplateInput,
} from "@/lib/whatsapp-meta";

const TEMPLATE_TABLE = "whatsapp_template_records";
const ASSIGNMENT_TABLE = "whatsapp_template_assignment_records";
const LOG_TABLE = "sms_log_records";
const DEFAULT_LANGUAGE = "en_US";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------
type TemplateRow = {
  id: string;
  name: string;
  language: string;
  category: string;
  meta_status: string;
  meta_template_id: string | null;
  payload: WhatsappTemplatePayload & {
    adminNotes?: string;
    archived?: boolean;
    lastSyncedAt?: string | null;
  };
};

type AssignmentRow = {
  id: string;
  purpose: string;
  plan_key: string;
  /** '*' = not salon-specific; otherwise a businesses.id */
  business_id: string;
  language: string;
  template_name: string;
  is_active: boolean;
  priority: number | null;
  created_by: string | null;
  updated_by: string | null;
  payload: {
    label?: string;
    group?: string;
    pricingCategory?: string;
    assignedBy?: string;
    assignedAt?: string;
    history?: { templateName: string; plan?: string; assignedBy: string; assignedAt: string }[];
    [k: string]: unknown;
  };
};

// ---------------------------------------------------------------------------
// Public view models
// ---------------------------------------------------------------------------
export type TemplateAssignmentView = {
  purpose: string;
  purposeLabel: string;
  group: string;
  plan: string;
  planLabel: string;
  /** '*' = not salon-specific. */
  businessId: string;
  /** Salon name when this is a salon-specific assignment, else null. */
  salonName: string | null;
  language: string;
  isActive: boolean;
  pricingCategory: string;
  compatibility: CompatibilityReport;
};

export type TemplateView = {
  id: string;
  name: string;
  language: string;
  category: string;
  metaStatus: string;
  metaTemplateId: string | null;
  qrStatus: QrTemplateStatus;
  archived: boolean;
  adminNotes: string;
  lastSyncedAt: string | null;
  createdVia: string;
  content: {
    headerText?: string;
    headerFormat?: string;
    body: string;
    footerText?: string;
    buttons: WhatsappTemplatePayload["buttons"];
    variables: WhatsappTemplatePayload["variables"];
  };
  rejectedReason: string | null;
  assignedTo: TemplateAssignmentView[];
  usage: TemplateUsage;
};

export type TemplateUsage = {
  tracked: boolean;
  window: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  lastUsedAt: string | null;
  lastError: string | null;
};

// ---------------------------------------------------------------------------
// Plan-aware assignment matrix
// ---------------------------------------------------------------------------
export type MatrixPurpose = {
  key: string;
  label: string;
  group: string;
  pricingCategory: string;
  availableVariableKeys: string[];
  defaultTemplateName: string;
  backendWired: boolean;
};

export type MatrixCell = {
  purpose: string;
  plan: string;
  language: string;
  /** the row explicitly assigned to THIS purpose+plan (any English locale) */
  assignedTemplateName: string | null;
  /** the actual stored language of that assignment row (may be 'en' vs 'en_US') */
  assignedLanguage: string | null;
  assignmentActive: boolean;
  assignmentCompatible: boolean;
  /** what the backend resolver would actually send for this plan+purpose+lang */
  resolvedTemplateName: string;
  resolvedVia: "plan" | "global" | "fallback";
  resolvedMetaStatus: string | null;
  sendable: boolean;
  /** APPROVED + variable-compatible templates that could be assigned here */
  candidateCount: number;
};

export type MatrixView = {
  language: string;
  plans: { key: string; label: string; isActive: boolean; order: number }[];
  purposes: MatrixPurpose[];
  cells: MatrixCell[];
};

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** PostgREST code when a table isn't in the schema cache (not created yet). */
const isMissingTableError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: string }).code === "PGRST205";

export class RegistryNotProvisionedError extends Error {
  readonly code = "REGISTRY_NOT_PROVISIONED";
  constructor() {
    super(
      "The WhatsApp template registry tables do not exist yet. Run " +
        "supabase/whatsapp-template-registry.sql in the Supabase SQL editor, then " +
        "seed them with `npm run seed:whatsapp-templates` in the backend.",
    );
  }
}

const loadTemplateRows = async (): Promise<TemplateRow[]> => {
  const { data, error } = await supabase.from(TEMPLATE_TABLE).select("*");
  if (error) {
    if (isMissingTableError(error)) throw new RegistryNotProvisionedError();
    throw error;
  }
  return (data ?? []) as TemplateRow[];
};

const loadAssignmentRows = async (): Promise<AssignmentRow[]> => {
  const { data, error } = await supabase.from(ASSIGNMENT_TABLE).select("*");
  if (error) {
    if (isMissingTableError(error)) throw new RegistryNotProvisionedError();
    throw error;
  }
  return (data ?? []) as AssignmentRow[];
};

export type PlanOption = { key: string; label: string; isActive: boolean; order: number };

const PLAN_TABLE = "subscription_plan_records";
const FALLBACK_PLAN_KEYS = ["lite", "growth", "professional", "multi_branch"];
const planLabelFor = (key: string, payloadName?: string): string =>
  payloadName?.trim() ||
  ({ lite: "Lite", growth: "Growth", professional: "Professional", multi_branch: "Multi Branch" }[key] ??
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

/**
 * Live subscription plans (so a NEW plan needs no code change). Reads
 * subscription_plan_records; if that table is unavailable it falls back to the
 * shipped plan-key list. The global ('*') row is added by the matrix builder.
 */
const loadPlans = async (): Promise<PlanOption[]> => {
  try {
    const { data, error } = await supabase
      .from(PLAN_TABLE)
      .select("plan_key, is_active, display_order, payload");
    if (error) throw error;
    const rows = (data ?? []) as {
      plan_key: string;
      is_active: boolean;
      display_order: number | null;
      payload: { name?: string } | null;
    }[];
    if (rows.length === 0) throw new Error("no plan rows");
    return rows
      .map((r) => ({
        key: r.plan_key,
        label: planLabelFor(r.plan_key, r.payload?.name),
        isActive: r.is_active !== false,
        order: r.display_order ?? 0,
      }))
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  } catch {
    return FALLBACK_PLAN_KEYS.map((key, i) => ({
      key,
      label: planLabelFor(key),
      isActive: true,
      order: i,
    }));
  }
};

export type SalonOption = { id: string; name: string };

const BUSINESS_TABLE = "businesses";

/**
 * Salon list for the assignment UI. Best-effort: if the table is unavailable
 * the feature degrades to plan/global assignments only rather than erroring.
 */
const loadSalons = async (): Promise<SalonOption[]> => {
  try {
    const { data, error } = await supabase
      .from(BUSINESS_TABLE)
      .select("id, business_name")
      .order("business_name", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as { id: string; business_name: string | null }[]).map((b) => ({
      id: b.id,
      name: b.business_name?.trim() || "Unnamed salon",
    }));
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Usage — derived from the shared sms_log_records table. Honest + bounded: we
// aggregate the most recent WhatsApp-channel log rows only.
// ---------------------------------------------------------------------------
const USAGE_SAMPLE = 3000;

const emptyUsage = (tracked: boolean): TemplateUsage => ({
  tracked,
  window: tracked ? `last ${USAGE_SAMPLE} WhatsApp sends` : "not tracked",
  total: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  lastUsedAt: null,
  lastError: null,
});

type UsageMap = Map<string, TemplateUsage>;

const loadUsageByTemplate = async (): Promise<UsageMap> => {
  const map: UsageMap = new Map();
  try {
    const { data, error } = await supabase
      .from(LOG_TABLE)
      .select("payload")
      .filter("payload->>channel", "eq", "whatsapp")
      .order("payload->>createdAt", { ascending: false })
      .limit(USAGE_SAMPLE);
    if (error) throw error;

    for (const row of (data ?? []) as { payload: Record<string, unknown> }[]) {
      const p = row.payload ?? {};
      const body = typeof p.body === "string" ? p.body : "";
      const match = body.match(/^\[whatsapp:([^\]]+)\]/);
      if (!match) continue;
      const name = match[1];
      const status = String(p.status ?? "");
      const createdAt = typeof p.createdAt === "string" ? p.createdAt : null;
      const reason = typeof p.reason === "string" ? p.reason : null;

      const u = map.get(name) ?? emptyUsage(true);
      u.total += 1;
      if (status === "sent") u.sent += 1;
      else if (status === "failed") u.failed += 1;
      else if (status === "skipped") u.skipped += 1;
      if (createdAt && (!u.lastUsedAt || createdAt > u.lastUsedAt)) u.lastUsedAt = createdAt;
      if (status === "failed" && reason && !u.lastError) u.lastError = reason;
      map.set(name, u);
    }
  } catch {
    // logs unreadable — surface "not tracked" rather than a fake zero
    return new Map();
  }
  return map;
};

// ---------------------------------------------------------------------------
// listTemplates
// ---------------------------------------------------------------------------
export type ListTemplatesResult = {
  templates: TemplateView[];
  plans: PlanOption[];
  /** salons available for salon-specific template assignments. */
  salons: SalonOption[];
  /** one matrix per language present in the registry (+ the default). */
  matrices: MatrixView[];
  /** false => the registry tables do not exist yet (run the DDL + seed). */
  provisioned: boolean;
};

const GLOBAL_PLAN = "*";

/**
 * Ordered (salon, plan, language) tiers the backend resolver tries — mirrored
 * here. Precedence: salon-specific → plan → global, each across the language
 * aliases then the default language.
 */
const resolutionTiers = (
  plan: string,
  language: string,
  businessId: string = GLOBAL_BUSINESS,
): { plan: string; business: string; language: string }[] => {
  const out: { plan: string; business: string; language: string }[] = [];
  const push = (p: string, b: string, l: string) => {
    if (!out.some((t) => t.plan === p && t.business === b && t.language === l))
      out.push({ plan: p, business: b, language: l });
  };
  const langs = [...new Set([...languageAliases(language), ...languageAliases(DEFAULT_LANGUAGE)])];
  if (businessId && businessId !== GLOBAL_BUSINESS) {
    for (const l of langs) push(GLOBAL_PLAN, businessId, l);
  }
  if (plan && plan !== GLOBAL_PLAN) {
    for (const l of langs) push(plan, GLOBAL_BUSINESS, l);
  }
  for (const l of langs) push(GLOBAL_PLAN, GLOBAL_BUSINESS, l);
  return out;
};

type TemplateStatusLookup = (name: string, language: string) => string | null;

/** Mirror of whatsappTemplateResolver.resolve — what WOULD the backend send. */
const resolveCell = (
  purpose: WhatsappPurpose,
  plan: string,
  language: string,
  assignmentsForPurpose: AssignmentRow[],
  statusOf: TemplateStatusLookup,
  businessId: string = GLOBAL_BUSINESS,
): { resolvedTemplateName: string; resolvedVia: "salon" | "plan" | "global" | "fallback"; resolvedMetaStatus: string | null; sendable: boolean } => {
  for (const tier of resolutionTiers(plan, language, businessId)) {
    const row = assignmentsForPurpose.find(
      (a) =>
        a.plan_key === tier.plan &&
        (a.business_id ?? GLOBAL_BUSINESS) === tier.business &&
        a.language === tier.language,
    );
    if (!row || !row.is_active) continue;
    const status = statusOf(row.template_name, tier.language) ?? "UNVERIFIED";
    if (status !== "APPROVED") continue;
    return {
      resolvedTemplateName: row.template_name,
      resolvedVia:
        tier.business !== GLOBAL_BUSINESS ? "salon" : tier.plan === GLOBAL_PLAN ? "global" : "plan",
      resolvedMetaStatus: status,
      sendable: true,
    };
  }
  // fail-open to the catalogue default name (sendable, pre-registry behaviour)
  return {
    resolvedTemplateName: purpose.defaultTemplateName,
    resolvedVia: "fallback",
    resolvedMetaStatus: null,
    sendable: true,
  };
};

const buildMatrix = (
  language: string,
  plans: PlanOption[],
  templateRows: TemplateRow[],
  assignmentRows: AssignmentRow[],
): MatrixView => {
  const statusOf: TemplateStatusLookup = (name, lang) =>
    templateRows.find((t) => t.name === name && t.language === lang)?.meta_status ??
    templateRows.find((t) => t.name === name)?.meta_status ??
    null;

  const planRows: MatrixView["plans"] = [
    { key: GLOBAL_PLAN, label: "Any plan (global)", isActive: true, order: -1 },
    ...plans.filter((p) => p.isActive),
  ];

  const langMatches = (l: string) => languageAliases(language).includes(l);

  const cells: MatrixCell[] = [];
  for (const purpose of WHATSAPP_PURPOSES) {
    const assignmentsForPurpose = assignmentRows.filter((a) => a.purpose === purpose.key);

    // APPROVED + variable-compatible templates in this language (or an alias) =
    // assignable here.
    const candidateCount = templateRows.filter(
      (t) =>
        langMatches(t.language) &&
        t.meta_status === "APPROVED" &&
        checkCompatibility(
          (t.payload?.variables ?? []).map((v) => v.key),
          purpose.availableVariableKeys,
        ).compatible,
    ).length;

    for (const plan of planRows) {
      // The matrix is purpose × plan only — salon-specific rows (business_id !=
      // '*') are shown in each template's drawer, never as a matrix cell.
      const own = assignmentsForPurpose.find(
        (a) =>
          a.plan_key === plan.key &&
          (a.business_id ?? GLOBAL_BUSINESS) === GLOBAL_BUSINESS &&
          langMatches(a.language),
      );
      const ownVarKeys = own
        ? (templateRows.find((t) => t.name === own.template_name && t.language === own.language)
            ?.payload?.variables ?? []).map((v) => v.key)
        : [];
      const cellResolved = resolveCell(purpose, plan.key, language, assignmentsForPurpose, statusOf);
      const resolved = {
        ...cellResolved,
        resolvedVia: cellResolved.resolvedVia === "salon" ? "global" : cellResolved.resolvedVia,
      };

      cells.push({
        purpose: purpose.key,
        plan: plan.key,
        language,
        assignedTemplateName: own?.template_name ?? null,
        assignedLanguage: own?.language ?? null,
        assignmentActive: Boolean(own?.is_active),
        assignmentCompatible: own
          ? checkCompatibility(ownVarKeys, purpose.availableVariableKeys).compatible
          : true,
        resolvedTemplateName: resolved.resolvedTemplateName,
        resolvedVia: resolved.resolvedVia,
        resolvedMetaStatus: resolved.resolvedMetaStatus,
        sendable: resolved.sendable,
        candidateCount,
      });
    }
  }

  return {
    language,
    plans: planRows,
    purposes: WHATSAPP_PURPOSES.map((p) => ({
      key: p.key,
      label: p.label,
      group: p.group,
      pricingCategory: p.pricingCategory,
      availableVariableKeys: p.availableVariableKeys,
      defaultTemplateName: p.defaultTemplateName,
      backendWired: p.backendWired,
    })),
    cells,
  };
};

export const listTemplates = async (): Promise<ListTemplatesResult> => {
  const [plans, salons] = await Promise.all([loadPlans(), loadSalons()]);
  const salonNameById = new Map(salons.map((s) => [s.id, s.name]));

  let templateRows: TemplateRow[];
  let assignmentRows: AssignmentRow[];
  let usageMap: UsageMap;
  try {
    [templateRows, assignmentRows, usageMap] = await Promise.all([
      loadTemplateRows(),
      loadAssignmentRows(),
      loadUsageByTemplate(),
    ]);
  } catch (error) {
    if (error instanceof RegistryNotProvisionedError) {
      return {
        templates: [],
        plans,
        salons,
        matrices: [buildMatrix(DEFAULT_LANGUAGE, plans, [], [])],
        provisioned: false,
      };
    }
    throw error;
  }

  const assignmentsByTemplateName = new Map<string, AssignmentRow[]>();
  for (const a of assignmentRows) {
    const list = assignmentsByTemplateName.get(a.template_name) ?? [];
    list.push(a);
    assignmentsByTemplateName.set(a.template_name, list);
  }

  const templates: TemplateView[] = templateRows
    .map((row) => {
      const payload = row.payload ?? ({} as TemplateRow["payload"]);
      const variableKeys = (payload.variables ?? []).map((v) => v.key);
      const boundAssignments = assignmentsByTemplateName.get(row.name) ?? [];

      const assignedTo: TemplateAssignmentView[] = boundAssignments.map((a) => {
        const purpose = purposeByKey(a.purpose);
        const businessId = a.business_id ?? GLOBAL_BUSINESS;
        return {
          purpose: a.purpose,
          purposeLabel: purpose?.label ?? a.purpose,
          group: purpose?.group ?? a.payload?.group ?? "Other",
          plan: a.plan_key ?? GLOBAL_PLAN,
          planLabel:
            (a.plan_key ?? GLOBAL_PLAN) === GLOBAL_PLAN
              ? "Any plan"
              : planLabelFor(a.plan_key),
          businessId,
          salonName:
            businessId === GLOBAL_BUSINESS ? null : salonNameById.get(businessId) ?? businessId,
          language: a.language,
          isActive: a.is_active,
          pricingCategory: purpose?.pricingCategory ?? a.payload?.pricingCategory ?? "unknown",
          compatibility: checkCompatibility(
            variableKeys,
            purpose?.availableVariableKeys ?? [],
          ),
        };
      });

      const hasActiveAssignment = boundAssignments.some((a) => a.is_active);
      const qrStatus = deriveQrStatus(
        boundAssignments.length > 0,
        hasActiveAssignment,
        row.meta_status,
      );

      return {
        id: row.id,
        name: row.name,
        language: row.language,
        category: row.category || payload.category || "",
        metaStatus: row.meta_status,
        metaTemplateId: row.meta_template_id,
        qrStatus,
        archived: Boolean(payload.archived),
        adminNotes: payload.adminNotes ?? "",
        lastSyncedAt: payload.lastSyncedAt ?? null,
        createdVia: payload.createdVia ?? "seed",
        content: {
          headerText: payload.headerText,
          headerFormat: payload.headerFormat,
          body: payload.body ?? "",
          footerText: payload.footerText,
          buttons: payload.buttons ?? [],
          variables: payload.variables ?? [],
        },
        rejectedReason: payload.metaRejectedReason ?? null,
        assignedTo,
        usage: usageMap.get(row.name) ?? emptyUsage(usageMap.size > 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));

  // One matrix per spoken language present in the registry. English locales
  // (en / en_US / en_GB) collapse into a single en_US matrix.
  const spokenLang = (l: string) => (["en", "en_US", "en_GB"].includes(l) ? DEFAULT_LANGUAGE : l);
  const languages = [
    ...new Set(
      [
        DEFAULT_LANGUAGE,
        ...templateRows.map((t) => t.language),
        ...assignmentRows.map((a) => a.language),
      ].map(spokenLang),
    ),
  ].sort();
  const matrices = languages.map((lang) => buildMatrix(lang, plans, templateRows, assignmentRows));

  return { templates, plans, salons, matrices, provisioned: true };
};

// ---------------------------------------------------------------------------
// Sync from Meta
// ---------------------------------------------------------------------------
export type SyncResult = {
  syncedAt: string;
  fetched: number;
  added: string[];
  updated: string[];
  statusChanges: { name: string; language: string; from: string; to: string }[];
  markedNotFound: string[];
};

export const syncFromMeta = async (): Promise<SyncResult> => {
  const metaTemplates = await fetchMetaMessageTemplates();
  const existing = await loadTemplateRows();
  const existingById = new Map(existing.map((r) => [r.id, r]));
  const syncedAt = new Date().toISOString();

  const result: SyncResult = {
    syncedAt,
    fetched: metaTemplates.length,
    added: [],
    updated: [],
    statusChanges: [],
    markedNotFound: [],
  };

  const seenIds = new Set<string>();
  const rowsToUpsert: TemplateRow[] = [];

  for (const meta of metaTemplates) {
    const id = templateRecordId(meta.name, meta.language);
    seenIds.add(id);
    const prior = existingById.get(id);
    const normalized = normalizeMetaTemplate(meta);

    // Preserve QR-Schedule-owned metadata; overwrite only Meta-owned fields.
    const mergedPayload: TemplateRow["payload"] = {
      ...normalized,
      adminNotes: prior?.payload?.adminNotes ?? "",
      archived: prior?.payload?.archived ?? false,
      createdVia: prior?.payload?.createdVia === "admin-submit" ? "admin-submit" : "meta-sync",
      createdAt: prior?.payload?.createdAt ?? syncedAt,
      replacesTemplateName: prior?.payload?.replacesTemplateName,
      lastSyncedAt: syncedAt,
    };

    rowsToUpsert.push({
      id,
      name: meta.name,
      language: meta.language,
      category: meta.category,
      meta_status: meta.status,
      meta_template_id: meta.id ?? prior?.meta_template_id ?? null,
      payload: mergedPayload,
    });

    if (!prior) {
      result.added.push(`${meta.name} (${meta.language})`);
    } else {
      if (prior.meta_status !== meta.status) {
        result.statusChanges.push({
          name: meta.name,
          language: meta.language,
          from: prior.meta_status,
          to: meta.status,
        });
      }
      result.updated.push(`${meta.name} (${meta.language})`);
    }
  }

  // Templates that once had a real Meta status but Meta no longer returns →
  // NOT_FOUND, never deleted. A row that has never been seen in Meta
  // (UNVERIFIED seed, or the placeholder for an admin-submitted template that
  // Meta has not listed yet) is left exactly as it is.
  const HAD_REAL_META_STATUS = new Set([
    "APPROVED",
    "PENDING",
    "IN_APPEAL",
    "REJECTED",
    "DISABLED",
    "PAUSED",
    "PENDING_DELETION",
  ]);
  for (const row of existing) {
    if (seenIds.has(row.id)) continue;
    if (!HAD_REAL_META_STATUS.has(row.meta_status)) continue;
    rowsToUpsert.push({
      ...row,
      meta_status: "NOT_FOUND",
      payload: { ...row.payload, lastSyncedAt: syncedAt },
    });
    result.statusChanges.push({
      name: row.name,
      language: row.language,
      from: row.meta_status,
      to: "NOT_FOUND",
    });
    result.markedNotFound.push(`${row.name} (${row.language})`);
  }

  if (rowsToUpsert.length > 0) {
    const { error } = await supabase.from(TEMPLATE_TABLE).upsert(rowsToUpsert, { onConflict: "id" });
    if (error) throw error;
  }

  return result;
};

// ---------------------------------------------------------------------------
// Assign / activate / deactivate / stop
// ---------------------------------------------------------------------------
export class TemplateActionError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus = 400) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

const getTemplateRowById = async (id: string): Promise<TemplateRow> => {
  const { data, error } = await supabase.from(TEMPLATE_TABLE).select("*").eq("id", id).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw new RegistryNotProvisionedError();
    throw error;
  }
  if (!data) throw new TemplateActionError("Template not found", 404);
  return data as TemplateRow;
};

const getAssignmentRow = async (
  purpose: string,
  plan: string,
  language: string,
  businessId: string = GLOBAL_BUSINESS,
): Promise<AssignmentRow | null> => {
  const { data, error } = await supabase
    .from(ASSIGNMENT_TABLE)
    .select("*")
    .eq("id", assignmentRecordId(purpose, plan, language, businessId))
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw new RegistryNotProvisionedError();
    throw error;
  }
  return (data as AssignmentRow) ?? null;
};

const KNOWN_PLAN_KEYS = new Set([GLOBAL_PLAN, ...FALLBACK_PLAN_KEYS]);
const assertKnownPlan = async (plan: string): Promise<void> => {
  if (KNOWN_PLAN_KEYS.has(plan)) return;
  // allow any plan_key that exists live in subscription_plan_records
  const plans = await loadPlans();
  if (!plans.some((p) => p.key === plan)) {
    throw new TemplateActionError(`Unknown subscription plan "${plan}"`);
  }
};

const assertCompatible = (template: TemplateRow, purpose: WhatsappPurpose): CompatibilityReport => {
  const variableKeys = (template.payload?.variables ?? []).map((v) => v.key);
  const report = checkCompatibility(variableKeys, purpose.availableVariableKeys);
  if (!report.compatible) {
    throw new TemplateActionError(
      `Template "${template.name}" needs variables this flow cannot supply: ${report.missing.join(", ")}. ` +
        `Not compatible with "${purpose.label}".`,
    );
  }
  return report;
};

export type AssignResult = {
  purpose: string;
  plan: string;
  businessId: string;
  salonName: string | null;
  language: string;
  templateName: string;
  previousTemplateName: string | null;
  isActive: boolean;
  metaStatus: string;
  activated: boolean;
  note: string;
};

/**
 * Bind a template to a (purpose, plan, language) — or to a single salon when
 * `businessId` is given, which takes precedence over the plan/global rows for
 * that salon (a salon binding is flat: plan is forced to '*'). If `activate` is
 * requested it is honoured only when Meta status = APPROVED; otherwise the
 * binding is created INACTIVE and the flow keeps using whatever it resolved
 * before (spec S12 — a pending template never goes live).
 */
export const assignTemplate = async (opts: {
  templateId: string;
  purpose: string;
  plan?: string;
  businessId?: string;
  language?: string;
  activate?: boolean;
  actor: string;
}): Promise<AssignResult> => {
  const language = opts.language ?? DEFAULT_LANGUAGE;
  const businessId = opts.businessId && opts.businessId !== GLOBAL_BUSINESS ? opts.businessId : GLOBAL_BUSINESS;
  // A salon binding is flat — it is never nested inside a plan.
  const plan = businessId !== GLOBAL_BUSINESS ? GLOBAL_PLAN : opts.plan ?? GLOBAL_PLAN;
  const purpose = purposeByKey(opts.purpose);
  if (!purpose) throw new TemplateActionError(`Unknown messaging purpose "${opts.purpose}"`);
  await assertKnownPlan(plan);

  let salonName: string | null = null;
  if (businessId !== GLOBAL_BUSINESS) {
    const salons = await loadSalons();
    if (salons.length > 0) {
      const salon = salons.find((s) => s.id === businessId);
      if (!salon) throw new TemplateActionError(`Unknown salon "${businessId}"`);
      salonName = salon.name;
    }
  }

  const template = await getTemplateRowById(opts.templateId);
  if (template.language !== language) {
    throw new TemplateActionError(
      `Template language (${template.language}) does not match the assignment language (${language}).`,
    );
  }
  assertCompatible(template, purpose);

  const existing = await getAssignmentRow(opts.purpose, plan, language, businessId);
  const previousTemplateName = existing?.template_name ?? null;

  const wantActive = Boolean(opts.activate);
  const canActivate = isMetaStatusSendable(template.meta_status);
  const isActive = wantActive && canActivate;

  const history = existing?.payload?.history ?? [];
  if (previousTemplateName && previousTemplateName !== template.name) {
    history.unshift({
      templateName: previousTemplateName,
      plan,
      assignedBy: existing?.payload?.assignedBy ?? "unknown",
      assignedAt: existing?.payload?.assignedAt ?? "unknown",
    });
  }

  const row: AssignmentRow = {
    id: assignmentRecordId(opts.purpose, plan, language, businessId),
    purpose: opts.purpose,
    plan_key: plan,
    business_id: businessId,
    language,
    template_name: template.name,
    is_active: isActive,
    priority: 0,
    created_by: existing?.created_by ?? opts.actor,
    updated_by: opts.actor,
    payload: {
      label: purpose.label,
      group: purpose.group,
      pricingCategory: purpose.pricingCategory,
      assignedBy: opts.actor,
      assignedAt: new Date().toISOString(),
      history: history.slice(0, 20),
    },
  };

  const { error } = await supabase.from(ASSIGNMENT_TABLE).upsert(row, { onConflict: "id" });
  if (error) throw error;

  const planLabel =
    businessId !== GLOBAL_BUSINESS
      ? `salon ${salonName ?? businessId}`
      : plan === GLOBAL_PLAN
        ? "any plan"
        : planLabelFor(plan);
  const note =
    wantActive && !canActivate
      ? `Assigned but left INACTIVE — Meta status is ${template.meta_status}, not APPROVED. ` +
        `${purpose.label} (${planLabel}) keeps using ${previousTemplateName ?? "its previous template"} until this is approved and activated.`
      : isActive
        ? `Assigned and active. ${purpose.label} for ${planLabel} now resolves to "${template.name}".`
        : `Assigned (inactive).`;

  return {
    purpose: opts.purpose,
    plan,
    businessId,
    salonName,
    language,
    templateName: template.name,
    previousTemplateName,
    isActive,
    metaStatus: template.meta_status,
    activated: isActive,
    note,
  };
};

export type ActivationResult = {
  purpose: string;
  plan: string;
  businessId: string;
  language: string;
  templateName: string;
  isActive: boolean;
};

export const setAssignmentActive = async (opts: {
  purpose: string;
  plan?: string;
  businessId?: string;
  language?: string;
  active: boolean;
  actor: string;
}): Promise<ActivationResult> => {
  const language = opts.language ?? DEFAULT_LANGUAGE;
  const businessId = opts.businessId && opts.businessId !== GLOBAL_BUSINESS ? opts.businessId : GLOBAL_BUSINESS;
  const plan = businessId !== GLOBAL_BUSINESS ? GLOBAL_PLAN : opts.plan ?? GLOBAL_PLAN;
  const purpose = purposeByKey(opts.purpose);
  if (!purpose) throw new TemplateActionError(`Unknown messaging purpose "${opts.purpose}"`);

  const assignment = await getAssignmentRow(opts.purpose, plan, language, businessId);
  if (!assignment) {
    const scopeLabel =
      businessId !== GLOBAL_BUSINESS
        ? "that salon"
        : plan === GLOBAL_PLAN
          ? "any plan"
          : planLabelFor(plan);
    throw new TemplateActionError(
      `"${purpose.label}" (${scopeLabel}) has no template assigned yet — assign one before activating.`,
    );
  }

  if (opts.active) {
    const template = await getTemplateRowById(templateRecordId(assignment.template_name, language));
    if (!isMetaStatusSendable(template.meta_status)) {
      throw new TemplateActionError(
        `Cannot activate: "${assignment.template_name}" is ${template.meta_status} in Meta, not APPROVED.`,
      );
    }
    assertCompatible(template, purpose);
  }

  const { error } = await supabase
    .from(ASSIGNMENT_TABLE)
    .update({
      is_active: opts.active,
      updated_by: opts.actor,
      payload: {
        ...assignment.payload,
        [opts.active ? "activatedBy" : "deactivatedBy"]: opts.actor,
        [opts.active ? "activatedAt" : "deactivatedAt"]: new Date().toISOString(),
      },
    })
    .eq("id", assignment.id);
  if (error) throw error;

  return {
    purpose: opts.purpose,
    plan,
    businessId,
    language,
    templateName: assignment.template_name,
    isActive: opts.active,
  };
};

export type StopResult = {
  templateName: string;
  affectedPurposes: {
    purpose: string;
    label: string;
    plan: string;
    planLabel: string;
    businessId: string;
    language: string;
  }[];
};

/** Emergency stop: turn every assignment that points at this template OFF. */
export const stopTemplate = async (opts: {
  templateId: string;
  actor: string;
}): Promise<StopResult> => {
  const template = await getTemplateRowById(opts.templateId);
  const { data, error } = await supabase
    .from(ASSIGNMENT_TABLE)
    .select("*")
    .eq("template_name", template.name);
  if (error) throw error;

  const rows = (data ?? []) as AssignmentRow[];
  const active = rows.filter((r) => r.is_active);
  const now = new Date().toISOString();

  for (const r of active) {
    const { error: upErr } = await supabase
      .from(ASSIGNMENT_TABLE)
      .update({
        is_active: false,
        updated_by: opts.actor,
        payload: { ...r.payload, stoppedBy: opts.actor, stoppedAt: now },
      })
      .eq("id", r.id);
    if (upErr) throw upErr;
  }

  return {
    templateName: template.name,
    affectedPurposes: rows.map((r) => {
      const businessId = r.business_id ?? GLOBAL_BUSINESS;
      return {
        purpose: r.purpose,
        label: purposeByKey(r.purpose)?.label ?? r.purpose,
        plan: r.plan_key ?? GLOBAL_PLAN,
        planLabel:
          businessId !== GLOBAL_BUSINESS
            ? `salon ${businessId}`
            : (r.plan_key ?? GLOBAL_PLAN) === GLOBAL_PLAN
              ? "any plan"
              : planLabelFor(r.plan_key),
        businessId,
        language: r.language,
      };
    }),
  };
};

export const setTemplateAdminMeta = async (opts: {
  templateId: string;
  adminNotes?: string;
  archived?: boolean;
}): Promise<void> => {
  const template = await getTemplateRowById(opts.templateId);
  const payload = {
    ...template.payload,
    ...(opts.adminNotes !== undefined ? { adminNotes: opts.adminNotes } : {}),
    ...(opts.archived !== undefined ? { archived: opts.archived } : {}),
  };
  const { error } = await supabase
    .from(TEMPLATE_TABLE)
    .update({ payload })
    .eq("id", template.id);
  if (error) throw error;
};

// ---------------------------------------------------------------------------
// Submit New Version → Meta
// ---------------------------------------------------------------------------
export type SubmitNewVersionResult = {
  templateName: string;
  language: string;
  metaTemplateId: string;
  metaStatus: string;
};

export const submitNewVersion = async (opts: {
  name: string;
  language?: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  body: string;
  headerText?: string;
  footerText?: string;
  buttons?: { type: string; text: string; url?: string }[];
  bodyExample?: string[];
  replacesTemplateName?: string;
  actor: string;
}): Promise<SubmitNewVersionResult> => {
  const language = opts.language ?? DEFAULT_LANGUAGE;
  const id = templateRecordId(opts.name, language);

  const { data: clash, error: clashError } = await supabase
    .from(TEMPLATE_TABLE)
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (clashError && isMissingTableError(clashError)) throw new RegistryNotProvisionedError();
  if (clash) {
    throw new TemplateActionError(
      `A template named "${opts.name}" (${language}) already exists locally. Pick a new version name, e.g. ${opts.name}_v2.`,
    );
  }

  const components: SubmitTemplateInput["components"] = [];
  if (opts.headerText) components.push({ type: "HEADER", format: "TEXT", text: opts.headerText });
  components.push({
    type: "BODY",
    text: opts.body,
    ...(opts.bodyExample && opts.bodyExample.length > 0
      ? { example: { body_text: [opts.bodyExample] } }
      : {}),
  });
  if (opts.footerText) components.push({ type: "FOOTER", text: opts.footerText });
  if (opts.buttons && opts.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: opts.buttons.map((b) => ({
        type: b.type,
        text: b.text,
        ...(b.url ? { url: b.url } : {}),
      })),
    });
  }

  const submitted = await submitMetaMessageTemplate({
    name: opts.name,
    language,
    category: opts.category,
    components,
  });

  const now = new Date().toISOString();
  const payload: TemplateRow["payload"] = {
    name: opts.name,
    language,
    category: opts.category,
    headerText: opts.headerText,
    body: opts.body,
    footerText: opts.footerText,
    buttons: (opts.buttons ?? []).map((b) => ({
      type: b.type,
      text: b.text,
      dynamic: b.type === "URL" ? /\{\{\s*\d+\s*\}\}/.test(b.url ?? "") : undefined,
    })),
    variables: [...opts.body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m, i) => ({
      position: i + 1,
      key: /^\d+$/.test(m[1]) ? `var${m[1]}` : m[1],
      label: `Variable ${m[1]}`,
    })),
    metaId: submitted.id,
    metaUpdatedAt: now,
    createdVia: "admin-submit",
    createdAt: now,
    replacesTemplateName: opts.replacesTemplateName,
    lastSyncedAt: now,
  };

  const { error } = await supabase.from(TEMPLATE_TABLE).upsert(
    {
      id,
      name: opts.name,
      language,
      category: opts.category,
      meta_status: submitted.status || "PENDING",
      meta_template_id: submitted.id,
      payload,
    },
    { onConflict: "id" },
  );
  if (error) throw error;

  return {
    templateName: opts.name,
    language,
    metaTemplateId: submitted.id,
    metaStatus: submitted.status || "PENDING",
  };
};
