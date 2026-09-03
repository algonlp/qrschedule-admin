/**
 * Profit / margin maths for the Messaging Cost & Profit Center.
 *
 * Rules that must never break (see PASS criteria):
 *   - All money is integer MINOR UNITS (paisa). No float money.
 *   - Provider cost UNKNOWN => profit and margin are null (shown as "-"),
 *     NEVER 0 and never "profit = full customer price / 100% margin".
 *   - Provider cost > customer price => a real NEGATIVE profit and margin.
 *     Never clamp to zero, never show a positive margin on a loss.
 *   - customer price 0 => margin null (no NaN / Infinity).
 *   - provider cost 0 (but known) => profit = customer price, markup null.
 */

import type { MessageCategory } from "./provider-costs";

export type Economics = {
  customerMinor: number;
  /** null = provider cost not configured for this category. */
  providerMinor: number | null;
  /** customerMinor - providerMinor; null when provider unknown. */
  profitMinor: number | null;
  /** (profit / customer) * 100, rounded to 2dp; null when unknown or customer<=0. */
  marginPct: number | null;
  /** (profit / provider) * 100, rounded to 2dp; null when unknown or provider<=0. */
  markupPct: number | null;
  outcome: "profit" | "break_even" | "loss" | "unknown";
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeEconomics(customerMinor: number, providerMinor: number | null): Economics {
  const customer = Number.isFinite(customerMinor) && customerMinor >= 0 ? Math.round(customerMinor) : 0;

  if (providerMinor === null || !Number.isFinite(providerMinor) || providerMinor < 0) {
    return {
      customerMinor: customer,
      providerMinor: null,
      profitMinor: null,
      marginPct: null,
      markupPct: null,
      outcome: "unknown",
    };
  }

  const provider = Math.round(providerMinor);
  const profit = customer - provider;

  const marginPct = customer > 0 ? round2((profit / customer) * 100) : null;
  const markupPct = provider > 0 ? round2((profit / provider) * 100) : null;

  const outcome: Economics["outcome"] = profit > 0 ? "profit" : profit < 0 ? "loss" : "break_even";

  return { customerMinor: customer, providerMinor: provider, profitMinor: profit, marginPct, markupPct, outcome };
}

// ---------------------------------------------------------------------------
// Category -> customer price mapping
// ---------------------------------------------------------------------------

/**
 * QR Schedule prices WhatsApp customer messages in two buckets only:
 *   - marketing  -> the WhatsApp campaign rate (payload.whatsappCampaignMessageCostCents)
 *   - everything transactional (utility, authentication) -> the transactional
 *     rate (payload.utilityMessageCostCents)
 *   - service (inbound / user-initiated) is free on both sides.
 * Keep this the single place that mapping lives.
 */
export function customerMinorForCategory(
  category: MessageCategory,
  rates: { whatsappCampaignMinor: number; transactionalMinor: number },
): number | null {
  switch (category) {
    case "marketing":
      return rates.whatsappCampaignMinor;
    case "utility":
    case "authentication":
      return rates.transactionalMinor;
    case "service":
      return 0;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Volume (estimated) economics
// ---------------------------------------------------------------------------

export type VolumeInput = {
  category: MessageCategory;
  messageCount: number;
  customerMinor: number;
  providerMinor: number | null;
};

export type VolumeEconomics = {
  category: MessageCategory;
  messageCount: number;
  customerRevenueMinor: number;
  /** null when provider cost unknown for this category. */
  providerCostMinor: number | null;
  grossProfitMinor: number | null;
  marginPct: number | null;
};

export function computeVolumeEconomics(input: VolumeInput): VolumeEconomics {
  const count = Number.isFinite(input.messageCount) && input.messageCount > 0 ? Math.floor(input.messageCount) : 0;
  const customer = Number.isFinite(input.customerMinor) && input.customerMinor >= 0 ? Math.round(input.customerMinor) : 0;
  const revenue = count * customer;

  if (input.providerMinor === null || !Number.isFinite(input.providerMinor) || input.providerMinor < 0) {
    return {
      category: input.category,
      messageCount: count,
      customerRevenueMinor: revenue,
      providerCostMinor: null,
      grossProfitMinor: null,
      marginPct: null,
    };
  }

  const cost = count * Math.round(input.providerMinor);
  const profit = revenue - cost;
  const marginPct = revenue > 0 ? round2((profit / revenue) * 100) : null;

  return {
    category: input.category,
    messageCount: count,
    customerRevenueMinor: revenue,
    providerCostMinor: cost,
    grossProfitMinor: profit,
    marginPct,
  };
}

export function sumVolumeEconomics(rows: VolumeEconomics[]): {
  messageCount: number;
  customerRevenueMinor: number;
  providerCostMinor: number | null;
  grossProfitMinor: number | null;
  marginPct: number | null;
  /** true when at least one category's provider cost was unknown - totals are partial. */
  partial: boolean;
} {
  let messageCount = 0;
  let customerRevenueMinor = 0;
  let providerCostMinor = 0;
  let anyKnown = false;
  let partial = false;

  for (const r of rows) {
    messageCount += r.messageCount;
    customerRevenueMinor += r.customerRevenueMinor;
    if (r.providerCostMinor === null) {
      partial = true;
    } else {
      providerCostMinor += r.providerCostMinor;
      anyKnown = true;
    }
  }

  if (!anyKnown) {
    return { messageCount, customerRevenueMinor, providerCostMinor: null, grossProfitMinor: null, marginPct: null, partial: true };
  }

  const grossProfitMinor = customerRevenueMinor - providerCostMinor;
  const marginPct = customerRevenueMinor > 0 ? round2((grossProfitMinor / customerRevenueMinor) * 100) : null;
  return { messageCount, customerRevenueMinor, providerCostMinor, grossProfitMinor, marginPct, partial };
}
