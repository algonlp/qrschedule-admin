import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENTITLEMENTS,
  PLAN_FEATURE_KEYS,
  planToRow,
  validatePlan,
  type SubscriptionPlan,
} from "./plans";

const basePlanInput = () => ({
  id: "plan_growth",
  key: "growth",
  name: "Growth",
  summary: "For a growing business.",
  amountCents: 499900,
  currencyCode: "PKR",
  billingInterval: "month",
  trialDays: 30,
  badgeLabel: "Most popular",
  isActive: true,
  displayOrder: 20,
  entitlements: { ...DEFAULT_ENTITLEMENTS, maxTeamMembers: 8, featureKeys: ["online_booking", "payments"] },
});

const ctx = (over: Partial<Parameters<typeof validatePlan>[1]> = {}) => ({
  isCreate: true,
  existing: [] as { id: string; key: string }[],
  ...over,
});

describe("validatePlan", () => {
  it("accepts a well-formed package and normalizes it", () => {
    const result = validatePlan(basePlanInput(), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.amountCents).toBe(499900);
    expect(result.plan.currencyCode).toBe("PKR");
    expect(result.plan.entitlements.featureKeys).toEqual(["online_booking", "payments"]);
    expect(typeof result.plan.updatedAt).toBe("string");
  });

  it("rejects a negative or fractional price", () => {
    const neg = validatePlan({ ...basePlanInput(), amountCents: -1 }, ctx());
    expect(neg.ok).toBe(false);
    const frac = validatePlan({ ...basePlanInput(), amountCents: 10.5 }, ctx());
    expect(frac.ok).toBe(false);
  });

  it("rejects a bad slug and a non-ISO currency", () => {
    const badKey = validatePlan({ ...basePlanInput(), key: "Growth Plan!" }, ctx());
    expect(badKey.ok).toBe(false);
    const badCurrency = validatePlan({ ...basePlanInput(), currencyCode: "Rupees" }, ctx());
    expect(badCurrency.ok).toBe(false);
  });

  it("rejects a duplicate key against another package", () => {
    const result = validatePlan(basePlanInput(), ctx({ existing: [{ id: "plan_other", key: "growth" }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("growth");
  });

  it("allows the same key on update for the package being edited", () => {
    const result = validatePlan(basePlanInput(), {
      isCreate: false,
      existing: [{ id: "plan_growth", key: "growth" }],
      currentId: "plan_growth",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown feature key", () => {
    const input = basePlanInput();
    input.entitlements.featureKeys = ["online_booking", "warp_drive"];
    const result = validatePlan(input, ctx());
    expect(result.ok).toBe(false);
  });

  it("keeps only known feature keys and de-duplicates them", () => {
    const input = basePlanInput();
    input.entitlements.featureKeys = ["online_booking", "online_booking", ...PLAN_FEATURE_KEYS];
    const result = validatePlan(input, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.entitlements.featureKeys).toEqual([...new Set(PLAN_FEATURE_KEYS)]);
  });

  it("treats a blank nullable limit as null and a blank required number as 0", () => {
    const input = basePlanInput();
    (input.entitlements as Record<string, unknown>).maxBookableStaffCap = "";
    (input.entitlements as Record<string, unknown>).includedMessages = "";
    const result = validatePlan(input, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.entitlements.maxBookableStaffCap).toBeNull();
    expect(result.plan.entitlements.includedMessages).toBe(0);
  });

  it("maps a plan to the subscription_plan_records row shape", () => {
    const result = validatePlan(basePlanInput(), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = planToRow(result.plan as SubscriptionPlan);
    expect(row).toMatchObject({
      id: "plan_growth",
      plan_key: "growth",
      is_active: true,
      display_order: 20,
    });
    expect(row.payload.amountCents).toBe(499900);
  });
});
