import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractVariables,
  getMetaConfigStatus,
  isMetaSubmitAllowed,
  normalizeMetaTemplate,
  submitMetaMessageTemplate,
  MetaWriteDisabledError,
  type MetaTemplate,
} from "./whatsapp-meta";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getMetaConfigStatus", () => {
  it("reports missing vars and never leaks the token", () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", "");
    const status = getMetaConfigStatus();
    expect(status.configured).toBe(false);
    expect(status.missing).toContain("WHATSAPP_ACCESS_TOKEN");
    expect(status.missing).toContain("WHATSAPP_BUSINESS_ACCOUNT_ID");
    expect(status.tokenHint).toBeNull();
  });

  it("is configured with both vars and only exposes a 4-char hint", () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "EAABsecretsecret1234");
    vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", "102938475610293");
    const status = getMetaConfigStatus();
    expect(status.configured).toBe(true);
    expect(status.missing).toEqual([]);
    expect(status.tokenHint).toBe("…1234");
    expect(status.tokenHint).not.toContain("secret");
  });

  it("is read-only against Meta by default", () => {
    vi.stubEnv("WHATSAPP_ALLOW_META_SUBMIT", "");
    expect(isMetaSubmitAllowed()).toBe(false);
    expect(getMetaConfigStatus().submitAllowed).toBe(false);
  });

  it("only allows Meta writes on an explicit opt-in", () => {
    vi.stubEnv("WHATSAPP_ALLOW_META_SUBMIT", "true");
    expect(isMetaSubmitAllowed()).toBe(true);
    vi.stubEnv("WHATSAPP_ALLOW_META_SUBMIT", "yes");
    expect(isMetaSubmitAllowed()).toBe(false);
  });
});

describe("submitMetaMessageTemplate guard", () => {
  it("throws MetaWriteDisabledError without the opt-in — before any network call", async () => {
    vi.stubEnv("WHATSAPP_ALLOW_META_SUBMIT", "");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "tok_abcd");
    vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", "waba_1");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      submitMetaMessageTemplate({ name: "x", language: "en_US", category: "UTILITY", components: [] }),
    ).rejects.toBeInstanceOf(MetaWriteDisabledError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("extractVariables", () => {
  it("pulls positional placeholders in order, de-duplicated", () => {
    const vars = extractVariables("Hi {{1}}, your {{2}} on {{3}}. See {{1}} again.");
    expect(vars.map((v) => v.position)).toEqual([1, 2, 3]);
    expect(vars.map((v) => v.key)).toEqual(["var1", "var2", "var3"]);
  });

  it("keeps named placeholders as their name", () => {
    const vars = extractVariables("Hello {{customer_name}}, code {{code}}");
    expect(vars.map((v) => v.key)).toEqual(["customer_name", "code"]);
  });
});

describe("normalizeMetaTemplate", () => {
  const meta: MetaTemplate = {
    id: "123456",
    name: "appointment_confirmed",
    language: "en_US",
    status: "APPROVED",
    category: "UTILITY",
    last_updated_time: "2026-08-01T00:00:00Z",
    components: [
      { type: "HEADER", format: "TEXT", text: "Booking update" },
      {
        type: "BODY",
        text: "Hi! Your appointment at {{1}} is confirmed for {{2}}. Service: {{3}}.",
      },
      { type: "FOOTER", text: "See you soon" },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "View booking", url: "https://x.test/b/{{1}}" }],
      },
    ],
  };

  it("maps components to the internal payload shape", () => {
    const payload = normalizeMetaTemplate(meta);
    expect(payload.name).toBe("appointment_confirmed");
    expect(payload.headerText).toBe("Booking update");
    expect(payload.footerText).toBe("See you soon");
    expect(payload.body).toContain("{{1}}");
    expect(payload.variables).toHaveLength(3);
    expect(payload.buttons[0]).toMatchObject({ type: "URL", text: "View booking", dynamic: true });
    expect(payload.metaId).toBe("123456");
    expect(payload.createdVia).toBe("meta-sync");
  });

  it("carries a real rejected reason but drops the NONE sentinel", () => {
    expect(normalizeMetaTemplate({ ...meta, rejected_reason: "NONE" }).metaRejectedReason).toBeNull();
    expect(
      normalizeMetaTemplate({ ...meta, status: "REJECTED", rejected_reason: "INVALID_FORMAT" })
        .metaRejectedReason,
    ).toBe("INVALID_FORMAT");
  });
});
