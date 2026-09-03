import { describe, expect, it } from "vitest";
import {
  rateSourceLabel,
  resolveRateForDate,
  validateProviderCost,
  type ProviderCostRecord,
} from "./provider-costs";

const base: Omit<ProviderCostRecord, "id" | "effectiveFrom" | "costPerMessageMinor"> = {
  provider: "meta",
  channel: "whatsapp",
  country: "PK",
  category: "marketing",
  currency: "PKR",
  sourceType: "manual",
  sourceUrl: "",
  effectiveTo: null,
  status: "active",
  notes: "",
  fetchedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "admin@example.com",
};

const rec = (id: string, effectiveFrom: string, costPerMessageMinor: number, over: Partial<ProviderCostRecord> = {}): ProviderCostRecord => ({
  ...base,
  id,
  effectiveFrom,
  costPerMessageMinor,
  ...over,
});

describe("validateProviderCost", () => {
  const good = {
    provider: "meta",
    channel: "whatsapp",
    country: "pk",
    category: "marketing",
    currency: "pkr",
    costPerMessageMinor: 800,
    sourceType: "manual",
    sourceUrl: "https://developers.facebook.com/docs/whatsapp/pricing",
    effectiveFrom: "2026-09-02",
  };

  it("accepts a valid manual rate and normalises case", () => {
    const r = validateProviderCost(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.country).toBe("PK");
      expect(r.value.currency).toBe("PKR");
      expect(r.value.costPerMessageMinor).toBe(800);
    }
  });

  it("rejects a negative cost", () => {
    expect(validateProviderCost({ ...good, costPerMessageMinor: -1 }).ok).toBe(false);
  });
  it("rejects a fractional (non-integer minor unit) cost", () => {
    expect(validateProviderCost({ ...good, costPerMessageMinor: 8.5 }).ok).toBe(false);
  });
  it("rejects an unknown category", () => {
    expect(validateProviderCost({ ...good, category: "promotional" }).ok).toBe(false);
  });
  it("rejects a bad country / currency", () => {
    expect(validateProviderCost({ ...good, country: "PAK" }).ok).toBe(false);
    expect(validateProviderCost({ ...good, currency: "Rs" }).ok).toBe(false);
  });
  it("rejects a bad effective date", () => {
    expect(validateProviderCost({ ...good, effectiveFrom: "02-09-2026" }).ok).toBe(false);
    expect(validateProviderCost({ ...good, effectiveFrom: "" }).ok).toBe(false);
  });
  it("rejects effectiveTo before effectiveFrom", () => {
    expect(validateProviderCost({ ...good, effectiveTo: "2026-08-01" }).ok).toBe(false);
  });
  it("rejects a non-http source URL", () => {
    expect(validateProviderCost({ ...good, sourceUrl: "ftp://x/y" }).ok).toBe(false);
    expect(validateProviderCost({ ...good, sourceUrl: "not a url" }).ok).toBe(false);
  });
  it("allows a blank source URL and blank effectiveTo", () => {
    const r = validateProviderCost({ ...good, sourceUrl: "", effectiveTo: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.effectiveTo).toBeNull();
  });
});

describe("resolveRateForDate", () => {
  const records = [
    rec("a", "2026-06-01", 700),
    rec("b", "2026-08-01", 800),
    rec("c", "2026-09-15", 900),
    rec("d", "2026-08-01", 999, { category: "utility" }),
    rec("e", "2026-08-01", 555, { status: "inactive" }),
  ];
  const sel = { provider: "meta", channel: "whatsapp", country: "PK", category: "marketing" };

  it("picks the latest effective rate on or before the date", () => {
    expect(resolveRateForDate(records, sel, "2026-07-01")?.id).toBe("a");
    expect(resolveRateForDate(records, sel, "2026-08-15")?.id).toBe("b");
    expect(resolveRateForDate(records, sel, "2026-09-20")?.id).toBe("c");
  });
  it("returns null before any rate exists (cost UNKNOWN, never zero)", () => {
    expect(resolveRateForDate(records, sel, "2026-01-01")).toBeNull();
  });
  it("does not cross category", () => {
    expect(resolveRateForDate(records, { ...sel, category: "utility" }, "2026-09-01")?.id).toBe("d");
    expect(resolveRateForDate(records, { ...sel, category: "authentication" }, "2026-09-01")).toBeNull();
  });
  it("ignores inactive rows", () => {
    const onlyInactive = [rec("x", "2026-01-01", 100, { status: "inactive" })];
    expect(resolveRateForDate(onlyInactive, sel, "2026-09-01")).toBeNull();
  });
  it("respects effectiveTo", () => {
    const bounded = [rec("y", "2026-01-01", 100, { effectiveTo: "2026-06-01" })];
    expect(resolveRateForDate(bounded, sel, "2026-05-01")?.id).toBe("y");
    expect(resolveRateForDate(bounded, sel, "2026-07-01")).toBeNull();
  });
});

describe("rateSourceLabel", () => {
  const now = new Date("2026-09-02T00:00:00.000Z");
  it("UNKNOWN when there is no rate", () => {
    expect(rateSourceLabel(null, now)).toBe("UNKNOWN");
  });
  it("MANUAL for a fresh manual rate", () => {
    expect(rateSourceLabel(rec("a", "2026-08-20", 800, { updatedAt: "2026-08-20T00:00:00.000Z" }), now)).toBe("MANUAL");
  });
  it("STALE for a manual rate older than the freshness window", () => {
    expect(rateSourceLabel(rec("a", "2026-01-01", 800, { updatedAt: "2026-01-01T00:00:00.000Z" }), now)).toBe("STALE");
  });
  it("LIVE only for a recently fetched live rate", () => {
    expect(
      rateSourceLabel(
        rec("a", "2026-09-01", 800, { sourceType: "live", fetchedAt: "2026-09-01T00:00:00.000Z" }),
        now,
      ),
    ).toBe("LIVE");
  });
  it("STALE for an old live rate", () => {
    expect(
      rateSourceLabel(rec("a", "2026-01-01", 800, { sourceType: "live", fetchedAt: "2026-01-01T00:00:00.000Z" }), now),
    ).toBe("STALE");
  });
});
