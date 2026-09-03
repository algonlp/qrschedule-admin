/**
 * Subscription package model for the QR Schedule Admin Panel.
 *
 * This is the admin-side mirror of the billing types that qrschedule.com
 * (the `bookmysalon` service) consumes. The shapes MUST stay compatible with:
 *   - bookmysalon/src/billing/billing.types.ts   (SubscriptionPlan, entitlements)
 *   - bookmysalon/src/billing/defaultPlans.ts     (billingFeatureCatalog)
 *   - bookmysalon/src/billing/storage/billingSupabase.store.ts (row mapping)
 *
 * The authoritative store for package configuration is the shared Supabase
 * table `subscription_plan_records`; this panel is its single editor.
 */

export type BillingInterval = "month" | "year";

/** The plan keys shipped as defaults. Admins may add packages with new keys. */
export const KNOWN_PLAN_KEYS = ["lite", "growth", "professional", "multi_branch"] as const;

/**
 * Feature catalogue - keep in sync with `billingFeatureCatalog` in
 * bookmysalon/src/billing/defaultPlans.ts. `requiredPlanKey` is informational
 * (drives copy on the public site); gating is done purely by whether a key is
 * present in a plan's `entitlements.featureKeys`.
 */
export const PLAN_FEATURE_CATALOG: { key: string; label: string; requiredPlanKey?: string }[] = [
  { key: "online_booking", label: "Online bookings" },
  { key: "qr_booking", label: "QR booking links" },
  { key: "payments", label: "Payments and checkout", requiredPlanKey: "growth" },
  { key: "service_packages", label: "Prepaid service packages", requiredPlanKey: "growth" },
  { key: "products", label: "Products and inventory", requiredPlanKey: "growth" },
  { key: "client_crm", label: "Full client CRM", requiredPlanKey: "growth" },
  { key: "advanced_reports", label: "Advanced reports", requiredPlanKey: "growth" },
  { key: "team_management", label: "Team calendars and staff tools", requiredPlanKey: "multi_branch" },
  { key: "marketing", label: "Marketing campaigns", requiredPlanKey: "lite" },
  { key: "csv_upload", label: "Upload CSV/XLSX customer lists", requiredPlanKey: "growth" },
  { key: "customer_segmentation", label: "Customer segmentation", requiredPlanKey: "growth" },
  { key: "loyalty_tools", label: "Loyalty and win-back tools", requiredPlanKey: "professional" },
  { key: "premium_support", label: "Premium support", requiredPlanKey: "growth" },
];

export const PLAN_FEATURE_KEYS = PLAN_FEATURE_CATALOG.map((feature) => feature.key);

export type SubscriptionPlanEntitlements = {
  /** Bookable staff members included in the base price. */
  maxTeamMembers: number;
  /** Hard ceiling on bookable staff (incl. paid add-ons). `null` = no fixed ceiling. */
  maxBookableStaffCap: number | null;
  /** Monthly price (minor units) per bookable staff member beyond maxTeamMembers. */
  extraBookableStaffPriceCents: number;
  /** Max locations/branches. `null` = admin-configurable / no fixed ceiling. */
  maxLocations: number | null;
  /** Monthly price (minor units) per branch beyond maxLocations. Quoted only. */
  extraLocationPriceCents: number;
  /** One-time campaign wallet credit (minor units) on first paid activation. */
  campaignCreditCents: number;
  /** Monthly included WhatsApp utility (transactional) message allowance. */
  whatsappUtilityMessageAllowance: number;
  /** Max campaigns promotable on the marketplace at once. */
  maxActiveMarketplaceOffers: number;
  includedMessages: number;
  includedMarketingEmails: number;
  includedAppointmentCredits: number;
  featureKeys: string[];
};

export type SubscriptionPlan = {
  id: string;
  key: string;
  name: string;
  summary: string;
  amountCents: number;
  currencyCode: string;
  billingInterval: BillingInterval;
  trialDays: number;
  badgeLabel: string;
  isActive: boolean;
  displayOrder: number;
  entitlements: SubscriptionPlanEntitlements;
  createdAt: string;
  updatedAt: string;
};

/** Row shape of `subscription_plan_records` (see bookmysalon store mapToRow). */
export type SubscriptionPlanRow = {
  id: string;
  plan_key: string;
  is_active: boolean;
  display_order: number;
  payload: SubscriptionPlan;
};

export const ENTITLEMENT_FIELDS: {
  key: keyof SubscriptionPlanEntitlements;
  label: string;
  nullable?: boolean;
  help?: string;
}[] = [
  { key: "maxTeamMembers", label: "Included bookable staff", help: "Staff included in the base price" },
  { key: "maxBookableStaffCap", label: "Bookable staff hard cap", nullable: true, help: "Blank = no fixed ceiling" },
  { key: "extraBookableStaffPriceCents", label: "Extra staff price / month" },
  { key: "maxLocations", label: "Included locations", nullable: true, help: "Blank = no fixed ceiling" },
  { key: "extraLocationPriceCents", label: "Extra location price / month" },
  { key: "campaignCreditCents", label: "One-time campaign credit" },
  { key: "whatsappUtilityMessageAllowance", label: "WhatsApp utility messages / month" },
  { key: "maxActiveMarketplaceOffers", label: "Active marketplace offers" },
  { key: "includedMessages", label: "Included SMS/WhatsApp / month" },
  { key: "includedMarketingEmails", label: "Included marketing emails / month" },
  { key: "includedAppointmentCredits", label: "Included appointment credits / month" },
];

/** Money-valued entitlement fields, shown as major units in the editor. */
export const ENTITLEMENT_MONEY_FIELDS: (keyof SubscriptionPlanEntitlements)[] = [
  "extraBookableStaffPriceCents",
  "extraLocationPriceCents",
  "campaignCreditCents",
];

export const DEFAULT_ENTITLEMENTS: SubscriptionPlanEntitlements = {
  maxTeamMembers: 1,
  maxBookableStaffCap: null,
  extraBookableStaffPriceCents: 0,
  maxLocations: 1,
  extraLocationPriceCents: 0,
  campaignCreditCents: 0,
  whatsappUtilityMessageAllowance: 0,
  maxActiveMarketplaceOffers: 1,
  includedMessages: 0,
  includedMarketingEmails: 0,
  includedAppointmentCredits: 0,
  featureKeys: ["online_booking", "qr_booking"],
};

const SLUG_RE = /^[a-z0-9_]+$/;

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function normalizeNullableInt(value: unknown, field: string, errors: string[]): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isInt(value) || value < 0) {
    errors.push(`${field} must be a whole number ≥ 0, or blank.`);
    return null;
  }
  return value;
}

function normalizeInt(value: unknown, field: string, errors: string[], fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  if (!isInt(value) || value < 0) {
    errors.push(`${field} must be a whole number ≥ 0.`);
    return fallback;
  }
  return value;
}

export type ValidatePlanContext = {
  isCreate: boolean;
  /** All packages that already exist, for the uniqueness checks. */
  existing: { id: string; key: string }[];
  /** id being edited, excluded from the uniqueness check on update. */
  currentId?: string;
};

export type ValidatePlanResult =
  | { ok: true; plan: SubscriptionPlan }
  | { ok: false; errors: string[] };

/**
 * Validate + normalize a plan payload coming from the editor or an API client.
 * Server and client both call this so the two never disagree.
 */
export function validatePlan(input: unknown, ctx: ValidatePlanContext): ValidatePlanResult {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();

  const id = String(raw.id ?? "").trim();
  const key = String(raw.key ?? raw.plan_key ?? "").trim();
  const name = String(raw.name ?? "").trim();
  const summary = String(raw.summary ?? "").trim();
  const badgeLabel = String(raw.badgeLabel ?? "").trim();
  const currencyCode = String(raw.currencyCode ?? "").trim().toUpperCase();
  const billingInterval = String(raw.billingInterval ?? "month").trim() as BillingInterval;

  if (!SLUG_RE.test(id)) errors.push("Plan id must be lowercase letters, numbers and underscores only.");
  if (!SLUG_RE.test(key)) errors.push("Plan key/slug must be lowercase letters, numbers and underscores only.");
  if (!name) errors.push("Public package name is required.");
  if (!summary) errors.push("Short description is required (it shows on the pricing page).");
  if (!/^[A-Z]{3}$/.test(currencyCode)) errors.push("Currency must be a 3-letter ISO code, e.g. PKR.");
  if (billingInterval !== "month" && billingInterval !== "year") {
    errors.push("Billing interval must be 'month' or 'year'.");
  }

  const others = ctx.existing.filter((entry) => entry.id !== ctx.currentId);
  if (ctx.isCreate && ctx.existing.some((entry) => entry.id === id)) {
    errors.push(`A package with id "${id}" already exists.`);
  }
  if (others.some((entry) => entry.key === key)) {
    errors.push(`Another package already uses the key/slug "${key}".`);
  }

  const amountCents = normalizeInt(raw.amountCents, "Price", errors);
  const trialDays = normalizeInt(raw.trialDays, "Trial days", errors);
  const displayOrder = isInt(raw.displayOrder) ? (raw.displayOrder as number) : 0;
  const isActive = raw.isActive === undefined ? true : Boolean(raw.isActive);

  const rawEnt = (raw.entitlements ?? {}) as Record<string, unknown>;
  const entitlements: SubscriptionPlanEntitlements = {
    maxTeamMembers: normalizeInt(rawEnt.maxTeamMembers, "Included bookable staff", errors, 1),
    maxBookableStaffCap: normalizeNullableInt(rawEnt.maxBookableStaffCap, "Bookable staff hard cap", errors),
    extraBookableStaffPriceCents: normalizeInt(rawEnt.extraBookableStaffPriceCents, "Extra staff price", errors),
    maxLocations: normalizeNullableInt(rawEnt.maxLocations, "Included locations", errors),
    extraLocationPriceCents: normalizeInt(rawEnt.extraLocationPriceCents, "Extra location price", errors),
    campaignCreditCents: normalizeInt(rawEnt.campaignCreditCents, "Campaign credit", errors),
    whatsappUtilityMessageAllowance: normalizeInt(
      rawEnt.whatsappUtilityMessageAllowance,
      "WhatsApp utility messages",
      errors,
    ),
    maxActiveMarketplaceOffers: normalizeInt(rawEnt.maxActiveMarketplaceOffers, "Marketplace offers", errors, 1),
    includedMessages: normalizeInt(rawEnt.includedMessages, "Included messages", errors),
    includedMarketingEmails: normalizeInt(rawEnt.includedMarketingEmails, "Included marketing emails", errors),
    includedAppointmentCredits: normalizeInt(rawEnt.includedAppointmentCredits, "Included appointment credits", errors),
    featureKeys: [],
  };

  const rawFeatureKeys = Array.isArray(rawEnt.featureKeys) ? rawEnt.featureKeys : [];
  const seen = new Set<string>();
  for (const featureKey of rawFeatureKeys) {
    const value = String(featureKey);
    if (!PLAN_FEATURE_KEYS.includes(value)) {
      errors.push(`Unknown feature key "${value}".`);
      continue;
    }
    if (!seen.has(value)) {
      seen.add(value);
      entitlements.featureKeys.push(value);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const createdAt = typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : now;

  return {
    ok: true,
    plan: {
      id,
      key,
      name,
      summary,
      amountCents,
      currencyCode,
      billingInterval,
      trialDays,
      badgeLabel,
      isActive,
      displayOrder,
      entitlements,
      createdAt,
      updatedAt: now,
    },
  };
}

export function planToRow(plan: SubscriptionPlan): SubscriptionPlanRow {
  return {
    id: plan.id,
    plan_key: plan.key,
    is_active: plan.isActive,
    display_order: plan.displayOrder,
    payload: plan,
  };
}

export function rowToPlan(row: { payload: unknown }): SubscriptionPlan {
  return row.payload as SubscriptionPlan;
}
