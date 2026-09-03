/**
 * Provider (Meta / SMS / email) messaging-cost configuration for the QR Schedule
 * Admin Panel's Messaging Cost & Profit Center.
 *
 * WHY THIS EXISTS: Meta does not expose a machine-readable current WhatsApp
 * per-message rate through any supported Graph API endpoint (the historical
 * `pricing_analytics` cost metric was deprecated for BSPs at the end of 2025).
 * There is therefore no "LIVE" source to implement today - the admin enters a
 * VERIFIED provider rate from Meta's official pricing page, and the UI labels
 * it MANUAL, never LIVE.
 *
 * This module is CONFIG + ANALYTICS ONLY. A provider cost never touches a
 * wallet, a Stripe charge, a subscription price, or a message send. Customer
 * pricing lives in `platform_settings` (see messaging-pricing.ts) and is read,
 * never written, here.
 *
 * Storage: table `provider_messaging_costs` (supabase/provider-messaging-costs.sql).
 * Multiple rows per (provider, channel, country, category) form a history;
 * the row effective on a given date is the active one with the latest
 * `effectiveFrom <= date` (and no `effectiveTo`, or `effectiveTo > date`).
 */

export const PROVIDERS = ["meta", "twilio", "email"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const CHANNELS = ["whatsapp", "sms", "email"] as const;
export type CostChannel = (typeof CHANNELS)[number];

/** WhatsApp/Meta pricing categories. `service` is inbound/user-initiated (free). */
export const CATEGORIES = ["marketing", "utility", "authentication", "service"] as const;
export type MessageCategory = (typeof CATEGORIES)[number];

export const SOURCE_TYPES = ["manual", "live"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const RATE_STATUSES = ["active", "inactive"] as const;
export type RateStatus = (typeof RATE_STATUSES)[number];

/** How the UI should label the resolved rate. */
export type RateSourceLabel = "LIVE" | "MANUAL" | "STALE" | "UNKNOWN";

/** Days before a manual/live rate is considered STALE. Env-overridable. */
export function freshnessDays(): number {
  const raw = Number(process.env.PROVIDER_RATE_FRESHNESS_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 90;
}

export type ProviderCostRecord = {
  id: string;
  provider: Provider | string;
  channel: CostChannel | string;
  country: string; // ISO-3166 alpha-2, uppercase
  category: MessageCategory | string;
  currency: string; // ISO-4217, uppercase
  costPerMessageMinor: number; // integer, >= 0, minor units of `currency`
  sourceType: SourceType | string;
  sourceUrl: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // YYYY-MM-DD or null (still effective)
  status: RateStatus | string;
  notes: string;
  fetchedAt: string | null; // set only for a genuine `live` fetch
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

/** DB row (snake_case) <-> record mapping. */
export type ProviderCostRow = {
  id: string;
  provider: string;
  channel: string;
  country: string;
  category: string;
  currency: string;
  cost_per_message_minor: number;
  source_type: string;
  source_url: string;
  effective_from: string;
  effective_to: string | null;
  status: string;
  notes: string;
  fetched_at: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
};

export function rowToRecord(row: ProviderCostRow): ProviderCostRecord {
  return {
    id: row.id,
    provider: row.provider,
    channel: row.channel,
    country: row.country,
    category: row.category,
    currency: row.currency,
    costPerMessageMinor: row.cost_per_message_minor,
    sourceType: row.source_type,
    sourceUrl: row.source_url ?? "",
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    status: row.status,
    notes: row.notes ?? "",
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? "",
  };
}

export function recordToRow(rec: ProviderCostRecord): ProviderCostRow {
  return {
    id: rec.id,
    provider: rec.provider,
    channel: rec.channel,
    country: rec.country,
    category: rec.category,
    currency: rec.currency,
    cost_per_message_minor: rec.costPerMessageMinor,
    source_type: rec.sourceType,
    source_url: rec.sourceUrl,
    effective_from: rec.effectiveFrom,
    effective_to: rec.effectiveTo,
    status: rec.status,
    notes: rec.notes,
    fetched_at: rec.fetchedAt,
    created_at: rec.createdAt,
    updated_at: rec.updatedAt,
    updated_by: rec.updatedBy,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO2_RE = /^[A-Z]{2}$/;
const ISO4217_RE = /^[A-Z]{3}$/;

export type ProviderCostInput = {
  provider?: unknown;
  channel?: unknown;
  country?: unknown;
  category?: unknown;
  currency?: unknown;
  costPerMessageMinor?: unknown;
  sourceType?: unknown;
  sourceUrl?: unknown;
  effectiveFrom?: unknown;
  effectiveTo?: unknown;
  status?: unknown;
  notes?: unknown;
};

export type ValidatedProviderCost = {
  provider: string;
  channel: string;
  country: string;
  category: string;
  currency: string;
  costPerMessageMinor: number;
  sourceType: string;
  sourceUrl: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  notes: string;
};

export type ValidateResult =
  | { ok: true; value: ValidatedProviderCost }
  | { ok: false; errors: string[] };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function validateProviderCost(input: ProviderCostInput): ValidateResult {
  const errors: string[] = [];

  const provider = str(input.provider).toLowerCase() || "meta";
  if (!PROVIDERS.includes(provider as Provider)) errors.push(`provider must be one of: ${PROVIDERS.join(", ")}.`);

  const channel = str(input.channel).toLowerCase() || "whatsapp";
  if (!CHANNELS.includes(channel as CostChannel)) errors.push(`channel must be one of: ${CHANNELS.join(", ")}.`);

  const country = str(input.country).toUpperCase() || "PK";
  if (!ISO2_RE.test(country)) errors.push("country must be a 2-letter ISO code (e.g. PK).");

  const category = str(input.category).toLowerCase();
  if (!CATEGORIES.includes(category as MessageCategory)) {
    errors.push(`category must be one of: ${CATEGORIES.join(", ")}.`);
  }

  const currency = str(input.currency).toUpperCase() || "PKR";
  if (!ISO4217_RE.test(currency)) errors.push("currency must be a 3-letter ISO code (e.g. PKR).");

  const rawCost = input.costPerMessageMinor;
  const cost = typeof rawCost === "number" ? rawCost : Number(rawCost);
  if (!Number.isFinite(cost) || !Number.isInteger(cost) || cost < 0) {
    errors.push("costPerMessageMinor must be a whole number of minor units (paisa/cents) >= 0.");
  }

  const sourceType = str(input.sourceType).toLowerCase() || "manual";
  if (!SOURCE_TYPES.includes(sourceType as SourceType)) {
    errors.push(`sourceType must be one of: ${SOURCE_TYPES.join(", ")}.`);
  }

  const sourceUrl = str(input.sourceUrl);
  if (sourceUrl) {
    try {
      const u = new URL(sourceUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") errors.push("sourceUrl must be an http(s) URL.");
    } catch {
      errors.push("sourceUrl must be a valid URL.");
    }
  }

  const effectiveFrom = str(input.effectiveFrom);
  if (!DATE_RE.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) {
    errors.push("effectiveFrom must be a valid YYYY-MM-DD date.");
  }

  let effectiveTo: string | null = null;
  const rawTo = str(input.effectiveTo);
  if (rawTo) {
    if (!DATE_RE.test(rawTo) || Number.isNaN(Date.parse(rawTo))) {
      errors.push("effectiveTo must be a valid YYYY-MM-DD date, or blank.");
    } else if (DATE_RE.test(effectiveFrom) && rawTo < effectiveFrom) {
      errors.push("effectiveTo cannot be before effectiveFrom.");
    } else {
      effectiveTo = rawTo;
    }
  }

  const status = str(input.status).toLowerCase() || "active";
  if (!RATE_STATUSES.includes(status as RateStatus)) {
    errors.push(`status must be one of: ${RATE_STATUSES.join(", ")}.`);
  }

  const notes = str(input.notes).slice(0, 2000);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      provider,
      channel,
      country,
      category,
      currency,
      costPerMessageMinor: cost,
      sourceType,
      sourceUrl,
      effectiveFrom,
      effectiveTo,
      status,
      notes,
    },
  };
}

// ---------------------------------------------------------------------------
// Resolution: which rate is effective on a given date
// ---------------------------------------------------------------------------

const keyOf = (r: Pick<ProviderCostRecord, "provider" | "channel" | "country" | "category">) =>
  `${r.provider}|${r.channel}|${r.country}|${r.category}`.toLowerCase();

/**
 * The rate effective on `onDate` (YYYY-MM-DD) for a given
 * provider/channel/country/category: the ACTIVE record with the latest
 * `effectiveFrom <= onDate`, whose `effectiveTo` is null or > onDate.
 * Returns null when nothing matches -> the caller must treat cost as UNKNOWN
 * (never zero).
 */
export function resolveRateForDate(
  records: ProviderCostRecord[],
  selector: Pick<ProviderCostRecord, "provider" | "channel" | "country" | "category">,
  onDate: string,
): ProviderCostRecord | null {
  const wantKey = keyOf(selector);
  const candidates = records
    .filter((r) => keyOf(r) === wantKey)
    .filter((r) => r.status === "active")
    .filter((r) => r.effectiveFrom <= onDate)
    .filter((r) => r.effectiveTo === null || r.effectiveTo > onDate)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
  return candidates[0] ?? null;
}

/**
 * Label for a resolved rate. `now` defaults to today; pass it for testing.
 * A `live`-sourced rate fetched within the freshness window is LIVE; anything
 * older (live or manual) is STALE; a fresh manual rate is MANUAL; no rate is
 * UNKNOWN.
 */
export function rateSourceLabel(
  record: ProviderCostRecord | null,
  now: Date = new Date(),
): RateSourceLabel {
  if (!record) return "UNKNOWN";
  const anchorIso =
    record.sourceType === "live" && record.fetchedAt ? record.fetchedAt : record.updatedAt || record.effectiveFrom;
  const anchor = Date.parse(anchorIso);
  const ageDays = Number.isFinite(anchor) ? (now.getTime() - anchor) / 86_400_000 : Infinity;
  if (ageDays > freshnessDays()) return "STALE";
  return record.sourceType === "live" ? "LIVE" : "MANUAL";
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
