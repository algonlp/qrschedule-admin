import { describe, expect, it } from "vitest";
import {
  computeEconomics,
  computeVolumeEconomics,
  customerMinorForCategory,
  sumVolumeEconomics,
} from "./messaging-economics";

describe("computeEconomics", () => {
  it("profit: customer 1900 (PKR 19), provider 800 (PKR 8)", () => {
    const e = computeEconomics(1900, 800);
    expect(e.profitMinor).toBe(1100);
    expect(e.marginPct).toBe(57.89); // 1100/1900*100 = 57.894...
    expect(e.markupPct).toBe(137.5); // 1100/800*100
    expect(e.outcome).toBe("profit");
  });

  it("break-even: customer === provider", () => {
    const e = computeEconomics(1900, 1900);
    expect(e.profitMinor).toBe(0);
    expect(e.marginPct).toBe(0);
    expect(e.outcome).toBe("break_even");
  });

  it("loss: provider 2200 > customer 1900 -> negative profit AND negative margin, not clamped", () => {
    const e = computeEconomics(1900, 2200);
    expect(e.profitMinor).toBe(-300);
    expect(e.marginPct).toBe(-15.79); // -300/1900*100
    expect(e.outcome).toBe("loss");
  });

  it("UNKNOWN provider cost -> profit and margin are null, NEVER zero or full price", () => {
    const e = computeEconomics(1900, null);
    expect(e.providerMinor).toBeNull();
    expect(e.profitMinor).toBeNull();
    expect(e.marginPct).toBeNull();
    expect(e.markupPct).toBeNull();
    expect(e.outcome).toBe("unknown");
  });

  it("provider 0 (known, free) -> profit = full customer price, markup null (no divide-by-zero)", () => {
    const e = computeEconomics(1900, 0);
    expect(e.profitMinor).toBe(1900);
    expect(e.marginPct).toBe(100);
    expect(e.markupPct).toBeNull();
    expect(e.outcome).toBe("profit");
  });

  it("customer 0 -> margin null, no NaN / Infinity", () => {
    const e = computeEconomics(0, 800);
    expect(e.profitMinor).toBe(-800);
    expect(e.marginPct).toBeNull();
    expect(Number.isFinite(e.markupPct ?? 0)).toBe(true);
    expect(e.outcome).toBe("loss");
  });

  it("treats a negative/garbage provider value as UNKNOWN, not a credit", () => {
    expect(computeEconomics(1900, -5).outcome).toBe("unknown");
    expect(computeEconomics(1900, Number.NaN as unknown as number).outcome).toBe("unknown");
  });

  it("minor units stay exact - no 100x / 10x drift", () => {
    const e = computeEconomics(4999_00 % 100000 === 900 ? 49900 : 49900, 12345);
    // 49900 - 12345 = 37555
    expect(e.profitMinor).toBe(37555);
  });
});

describe("customerMinorForCategory", () => {
  const rates = { whatsappCampaignMinor: 1900, transactionalMinor: 700 };
  it("marketing -> campaign rate", () => expect(customerMinorForCategory("marketing", rates)).toBe(1900));
  it("utility -> transactional rate", () => expect(customerMinorForCategory("utility", rates)).toBe(700));
  it("authentication -> transactional rate (QR Schedule does not price auth separately)", () =>
    expect(customerMinorForCategory("authentication", rates)).toBe(700));
  it("service -> 0 (free)", () => expect(customerMinorForCategory("service", rates)).toBe(0));
});

describe("computeVolumeEconomics", () => {
  it("10,000 marketing msgs: revenue 190000000, cost 80000000, profit 110000000", () => {
    const v = computeVolumeEconomics({ category: "marketing", messageCount: 10_000, customerMinor: 1900, providerMinor: 800 });
    expect(v.customerRevenueMinor).toBe(19_000_000);
    expect(v.providerCostMinor).toBe(8_000_000);
    expect(v.grossProfitMinor).toBe(11_000_000);
    expect(v.marginPct).toBe(57.89);
  });
  it("unknown provider cost -> cost/profit null (not zero), revenue still computed", () => {
    const v = computeVolumeEconomics({ category: "utility", messageCount: 100, customerMinor: 700, providerMinor: null });
    expect(v.customerRevenueMinor).toBe(70_000);
    expect(v.providerCostMinor).toBeNull();
    expect(v.grossProfitMinor).toBeNull();
  });
  it("floors a fractional / negative count", () => {
    expect(computeVolumeEconomics({ category: "marketing", messageCount: -5, customerMinor: 1900, providerMinor: 800 }).messageCount).toBe(0);
  });
});

describe("sumVolumeEconomics", () => {
  it("sums known categories and flags partial when one is unknown", () => {
    const rows = [
      computeVolumeEconomics({ category: "marketing", messageCount: 100, customerMinor: 1900, providerMinor: 800 }),
      computeVolumeEconomics({ category: "utility", messageCount: 50, customerMinor: 700, providerMinor: null }),
    ];
    const total = sumVolumeEconomics(rows);
    expect(total.messageCount).toBe(150);
    expect(total.customerRevenueMinor).toBe(100 * 1900 + 50 * 700);
    expect(total.providerCostMinor).toBe(100 * 800); // only the known one
    expect(total.partial).toBe(true);
  });
  it("all unknown -> totals null, partial true", () => {
    const rows = [computeVolumeEconomics({ category: "marketing", messageCount: 10, customerMinor: 1900, providerMinor: null })];
    const total = sumVolumeEconomics(rows);
    expect(total.providerCostMinor).toBeNull();
    expect(total.grossProfitMinor).toBeNull();
    expect(total.partial).toBe(true);
  });
});
