/**
 * QR Schedule WhatsApp template registry — Admin Panel side.
 *
 * FOUR concerns are kept strictly separate (feature spec FINAL RULE):
 *   1. Meta template            — what Meta/WABA knows. Meta is authoritative.
 *   2. QR Schedule assignment    — which template a (purpose, plan, language)
 *                                 uses and whether QR Schedule may send with it.
 *   3. WhatsApp channel switch   — the existing kill-switch. Never overridden here.
 *   4. Messaging pricing         — decided by the PURPOSE, never by the template.
 *
 * The messaging PURPOSES and PLAN keys below mirror
 * `bookmysalon/src/notifications/whatsappTemplateCatalog.ts` (the runtime
 * resolver's source of truth). Keep them in sync. Plan keys also mirror
 * `subscription_plan_records.plan_key`; the Admin Panel additionally loads the
 * live plan list from that table so a NEW plan needs no code change.
 */

export type WhatsappTemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION" | string;

export type WhatsappMetaStatus =
  | "UNVERIFIED"
  | "APPROVED"
  | "PENDING"
  | "IN_APPEAL"
  | "REJECTED"
  | "DISABLED"
  | "PAUSED"
  | "PENDING_DELETION"
  | "DELETED"
  | "NOT_FOUND"
  | string;

/** How QR Schedule is using a template right now — derived, never stored raw. */
export type QrTemplateStatus = "active" | "inactive" | "unassigned";

export type WhatsappTemplateVariable = { position: number; key: string; label: string };

export type WhatsappTemplateButton = {
  type: "URL" | "QUICK_REPLY" | "COPY_CODE" | "PHONE_NUMBER" | string;
  text: string;
  dynamic?: boolean;
};

export type WhatsappTemplatePayload = {
  name: string;
  language: string;
  category: WhatsappTemplateCategory;
  headerText?: string;
  headerFormat?: string;
  body: string;
  footerText?: string;
  buttons: WhatsappTemplateButton[];
  variables: WhatsappTemplateVariable[];
  wiredIntoCode?: boolean;
  notes?: string;
  metaId?: string | null;
  metaUpdatedAt?: string | null;
  metaRejectedReason?: string | null;
  createdVia?: "seed" | "meta-sync" | "admin-submit";
  createdAt?: string;
  replacesTemplateName?: string;
};

// ---------------------------------------------------------------------------
// Subscription plans
// ---------------------------------------------------------------------------
export const GLOBAL_PLAN = "*";
/** Sentinel `business_id` for an assignment that is NOT salon-specific. */
export const GLOBAL_BUSINESS = "*";
/** Fallback plan list; the live list is read from subscription_plan_records. */
export const WHATSAPP_PLAN_KEYS = ["lite", "growth", "professional", "multi_branch"] as const;
export type WhatsappPlanKey = (typeof WHATSAPP_PLAN_KEYS)[number] | "*" | string;

export type PlanOption = { key: string; label: string; isActive: boolean; order: number };

/** Global row shown first in the matrix. */
export const GLOBAL_PLAN_OPTION: PlanOption = {
  key: GLOBAL_PLAN,
  label: "Any plan (global)",
  isActive: true,
  order: -1,
};

const PLAN_LABEL_FALLBACK: Record<string, string> = {
  lite: "Lite",
  growth: "Growth",
  professional: "Professional",
  multi_branch: "Multi Branch",
};

export const planLabel = (key: string): string =>
  key === GLOBAL_PLAN
    ? GLOBAL_PLAN_OPTION.label
    : PLAN_LABEL_FALLBACK[key] ??
      key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Messaging purposes
// ---------------------------------------------------------------------------
export type WhatsappPurposeKey =
  | "otp"
  | "waitlist_slot_opened"
  | "appointment_confirmed"
  | "appointment_rescheduled"
  | "appointment_running_late"
  | "appointment_reminder"
  | "appointment_cancelled"
  | "campaign_percent_off"
  | "campaign_flat_amount_off"
  | "campaign_free_service"
  | "campaign_custom_offer"
  | "campaign_happy_hour"
  | "campaign_last_minute_fill"
  | "campaign_loyalty"
  | "campaign_seasonal"
  | "campaign_signature";

export type WhatsappPurposeGroup = "Authentication" | "Appointment" | "Campaign";

export type WhatsappPurpose = {
  key: WhatsappPurposeKey;
  label: string;
  group: WhatsappPurposeGroup;
  pricingCategory: "transactional" | "campaign" | "none";
  availableVariableKeys: string[];
  defaultTemplateName: string;
  /** true when a backend send path resolves this purpose today. */
  backendWired: boolean;
};

const APPT_VARS = ["businessName", "appointmentDateTime", "serviceName", "bookingReference"];

export const WHATSAPP_PURPOSES: WhatsappPurpose[] = [
  {
    key: "otp",
    label: "One-time verification code",
    group: "Authentication",
    pricingCategory: "none",
    availableVariableKeys: ["code"],
    defaultTemplateName: "otp_verification",
    backendWired: true,
  },
  {
    key: "waitlist_slot_opened",
    label: "Waitlist slot opened",
    group: "Appointment",
    pricingCategory: "transactional",
    availableVariableKeys: ["serviceLabel", "appointmentDateTime", "offerMinutes"],
    defaultTemplateName: "waitlist_slot_opened",
    backendWired: true,
  },
  {
    key: "appointment_confirmed",
    label: "Booking confirmation",
    group: "Appointment",
    pricingCategory: "transactional",
    availableVariableKeys: APPT_VARS,
    defaultTemplateName: "appointment_confirmed",
    backendWired: true,
  },
  {
    key: "appointment_rescheduled",
    label: "Appointment rescheduled",
    group: "Appointment",
    pricingCategory: "transactional",
    availableVariableKeys: APPT_VARS,
    defaultTemplateName: "appointment_rescheduled",
    backendWired: true,
  },
  {
    key: "appointment_running_late",
    label: "Appointment running late",
    group: "Appointment",
    pricingCategory: "transactional",
    availableVariableKeys: ["businessName", "serviceName", "appointmentDateTime", "delayNote"],
    defaultTemplateName: "appointment_running_late",
    backendWired: true,
  },
  {
    key: "appointment_reminder",
    label: "Appointment reminder",
    group: "Appointment",
    pricingCategory: "transactional",
    availableVariableKeys: APPT_VARS,
    defaultTemplateName: "appointment_reminder",
    backendWired: false,
  },
  {
    key: "appointment_cancelled",
    label: "Appointment cancellation",
    group: "Appointment",
    pricingCategory: "transactional",
    availableVariableKeys: APPT_VARS,
    defaultTemplateName: "appointment_cancelled",
    backendWired: false,
  },
  {
    key: "campaign_percent_off",
    label: "Campaign — percent off",
    group: "Campaign",
    pricingCategory: "campaign",
    availableVariableKeys: ["customerName", "businessName", "discountLabel", "serviceName", "bookingLink"],
    defaultTemplateName: "promo_percent_off",
    backendWired: true,
  },
  {
    key: "campaign_flat_amount_off",
    label: "Campaign — flat amount off",
    group: "Campaign",
    pricingCategory: "campaign",
    availableVariableKeys: ["customerName", "discountLabel", "serviceName", "businessName", "bookingLink"],
    defaultTemplateName: "promo_flat_amount_off",
    backendWired: true,
  },
  {
    key: "campaign_free_service",
    label: "Campaign — free service",
    group: "Campaign",
    pricingCategory: "campaign",
    availableVariableKeys: ["customerName", "businessName", "serviceName", "bookingLink"],
    defaultTemplateName: "promo_free_service",
    backendWired: true,
  },
  {
    key: "campaign_custom_offer",
    label: "Campaign — custom offer",
    group: "Campaign",
    pricingCategory: "campaign",
    availableVariableKeys: ["customerName", "businessName", "offerName", "serviceName", "bookingLink"],
    defaultTemplateName: "promo_custom_offer",
    backendWired: true,
  },
  {
    key: "campaign_happy_hour",
    label: "Campaign — happy hour",
    group: "Campaign",
    pricingCategory: "campaign",
    availableVariableKeys: [
      "startTime",
      "endTime",
      "offerName",
      "serviceName",
      "discountedPrice",
      "originalPrice",
      "businessName",
      "bookingLink",
    ],
    defaultTemplateName: "promo_happy_hour",
    backendWired: true,
  },
  {
    key: "campaign_last_minute_fill",
    label: "Campaign — last-minute fill",
    group: "Campaign",
    pricingCategory: "campaign",
    availableVariableKeys: ["slotTime", "businessName", "discountLabel", "serviceName", "seatsLeft", "bookingLink"],
    defaultTemplateName: "promo_last_minute_fill",
    backendWired: true,
  },
  {
    key: "campaign_loyalty",
    label: "Campaign — loyalty reward",
    group: "Campaign",
    pricingCategory: "campaign",
    availableVariableKeys: ["customerName", "businessName", "serviceName", "bookingLink", "rewardLabel"],
    defaultTemplateName: "campaign_loyalty",
    backendWired: false,
  },
  {
    key: "campaign_seasonal",
    label: "Campaign — seasonal refresh",
    group: "Campaign",
    pricingCategory: "campaign",
    availableVariableKeys: ["customerName", "businessName", "serviceName", "bookingLink", "seasonLabel"],
    defaultTemplateName: "campaign_seasonal",
    backendWired: false,
  },
  {
    key: "campaign_signature",
    label: "Campaign — signature service",
    group: "Campaign",
    pricingCategory: "campaign",
    availableVariableKeys: ["customerName", "businessName", "serviceName", "bookingLink"],
    defaultTemplateName: "campaign_signature",
    backendWired: false,
  },
];

export const WHATSAPP_PURPOSE_KEYS = WHATSAPP_PURPOSES.map((p) => p.key);

export const purposeByKey = (key: string): WhatsappPurpose | undefined =>
  WHATSAPP_PURPOSES.find((p) => p.key === key);

export const templateRecordId = (name: string, language: string): string => `${name}__${language}`;

/**
 * Assignment row id — keyed by purpose + plan + language, plus a salon segment
 * when the assignment is salon-specific. A non-salon row (`businessId` = '*')
 * keeps the original 3-part id, so existing global/plan assignments are
 * unaffected.
 */
export const assignmentRecordId = (
  purpose: string,
  plan: string = GLOBAL_PLAN,
  language: string = "en_US",
  businessId: string = GLOBAL_BUSINESS,
): string =>
  businessId && businessId !== GLOBAL_BUSINESS
    ? `${purpose}__${plan}__${language}__b_${businessId}`
    : `${purpose}__${plan}__${language}`;

// ---------------------------------------------------------------------------
// Compatibility
//
// A purpose's flow emits a FIXED, ordered list of body parameters (see
// `availableVariableKeys`). Two kinds of template:
//   • positional ({{1}}, {{2}}, … → keys var1, var2, …): Meta rejects a send
//     whose parameter count differs, so the template's var count must EQUAL the
//     number the flow emits.
//   • named ({{customer_name}} …): every named key must be one the flow supplies.
// ---------------------------------------------------------------------------
const isPositionalKey = (k: string): boolean => /^var\d+$/.test(k);
const allPositional = (keys: string[]): boolean => keys.length > 0 && keys.every(isPositionalKey);

export type CompatibilityReport = {
  compatible: boolean;
  satisfied: string[];
  missing: string[];
};

export const checkCompatibility = (
  templateVariableKeys: string[],
  purposeAvailableKeys: string[],
): CompatibilityReport => {
  if (allPositional(templateVariableKeys)) {
    const need = templateVariableKeys.length;
    const have = purposeAvailableKeys.length;
    return need === have
      ? { compatible: true, satisfied: templateVariableKeys, missing: [] }
      : {
          compatible: false,
          satisfied: [],
          missing: [`template uses ${need} variables, this flow supplies exactly ${have}`],
        };
  }
  const satisfied = templateVariableKeys.filter((k) => purposeAvailableKeys.includes(k));
  const missing = templateVariableKeys.filter((k) => !purposeAvailableKeys.includes(k));
  return { compatible: missing.length === 0, satisfied, missing };
};

export const isTemplateCompatibleWithPurpose = (
  templateVariableKeys: string[],
  purposeAvailableKeys: string[],
): boolean => checkCompatibility(templateVariableKeys, purposeAvailableKeys).compatible;

export const isMetaStatusSendable = (status: string): boolean => status === "APPROVED";

export const deriveQrStatus = (
  hasAssignment: boolean,
  assignmentActive: boolean,
  metaStatus: string,
): QrTemplateStatus => {
  if (!hasAssignment) return "unassigned";
  if (assignmentActive && isMetaStatusSendable(metaStatus)) return "active";
  return "inactive";
};

/** Meta locale codes that mean the same spoken language (English). */
export const languageAliases = (language: string): string[] => {
  const english = ["en_US", "en", "en_GB"];
  return english.includes(language)
    ? [language, ...english.filter((l) => l !== language)]
    : [language];
};

export const metaStatusLabel = (status: string): string => {
  const map: Record<string, string> = {
    UNVERIFIED: "Not synced",
    APPROVED: "Approved",
    PENDING: "Pending review",
    IN_APPEAL: "In appeal",
    REJECTED: "Rejected",
    DISABLED: "Disabled",
    PAUSED: "Paused",
    PENDING_DELETION: "Pending deletion",
    DELETED: "Deleted",
    NOT_FOUND: "Not found in Meta",
  };
  return map[status] ?? status;
};
