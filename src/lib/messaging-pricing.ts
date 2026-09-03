/**
 * Messaging & campaign pricing control for the QR Schedule Admin Panel.
 *
 * QR Schedule (`bookmysalon`) charges per message. The rates live in the shared
 * Supabase `platform_settings` row `id = 'global'` (jsonb payload):
 *
 *   payload.smsCampaignMessageCostCents      - SMS campaign send
 *   payload.whatsappCampaignMessageCostCents - WhatsApp campaign send
 *   payload.emailCampaignMessageCostCents    - email campaign send
 *   payload.utilityMessageCostCents          - transactional send (booking
 *                                              confirmation / reminder past a
 *                                              plan allowance, and extra credits)
 *   payload.campaignMessageCostCents         - LEGACY single campaign rate;
 *                                              still the fallback for any
 *                                              campaign channel with no override
 *
 * Every field is NULLABLE. For a campaign channel, `null`/absent =>
 * `campaignMessageCostCents` => env default. For utility, `null` => env default.
 * `platformSettingsService.getCampaignPricing()` resolves exactly this chain,
 * so a value written here is picked up by qrschedule.com with no further code.
 *
 * This module is a CONTROL surface - it never seeds, resets or migrates. Each
 * rate has an on/off toggle: OFF => the field is stored as `null` and the rate
 * follows the system default; ON => the admin's number is stored.
 */

export const PLATFORM_SETTINGS_ROW_ID = "global";

/**
 * bookmysalon env defaults - mirror of `WALLET_PROMOTIONAL_MESSAGE_COST_CENTS`
 * (1900) and `WALLET_UTILITY_MESSAGE_COST_CENTS` (700) in
 * bookmysalon/src/config/env.ts. Production `.env` does not override these.
 */
export const DEFAULT_CAMPAIGN_MESSAGE_COST_CENTS = 1900;
export const DEFAULT_UTILITY_MESSAGE_COST_CENTS = 700;

export type Channel = "sms" | "whatsapp" | "email";
export const CHANNELS: Channel[] = ["sms", "whatsapp", "email"];

/**
 * Static fallback for whether each channel's provider is set up. Mirror of
 * `isChannelProviderConfigured()` in bookmysalon; used only for UI hints
 * ("provider not configured"). The real send-time enforcement lives in
 * bookmysalon and is correct regardless of this.
 *
 * SMS (Twilio) and email (SMTP) are assumed present. WhatsApp is treated as
 * configured only when the Meta Cloud API env vars are actually set — see
 * `isChannelProviderConfigured()` below, which `resolveChannels()` uses.
 */
export const CHANNEL_PROVIDER_CONFIGURED: Record<Channel, boolean> = {
  sms: true,
  whatsapp: false,
  email: true,
};

/**
 * Runtime provider check. Server-only (reads non-public env); `resolveChannels`
 * is the sole caller and only runs in the messaging-pricing API route. For
 * WhatsApp, a channel counts as configured once the Meta WhatsApp Cloud API
 * credentials are present in this deployment's environment.
 */
export function isChannelProviderConfigured(channel: Channel): boolean {
  if (channel === "whatsapp") {
    return Boolean(
      process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
        process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() &&
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim(),
    );
  }
  return CHANNEL_PROVIDER_CONFIGURED[channel];
}

export const CHANNEL_FIELD: Record<Channel, string> = {
  sms: "smsChannelEnabled",
  whatsapp: "whatsappChannelEnabled",
  email: "emailChannelEnabled",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
};

export type RateKey = "sms" | "whatsapp" | "email" | "transactional";

export const RATE_KEYS: RateKey[] = ["sms", "whatsapp", "email", "transactional"];

/** platform_settings.payload field backing each rate. */
export const RATE_FIELD: Record<RateKey, string> = {
  sms: "smsCampaignMessageCostCents",
  whatsapp: "whatsappCampaignMessageCostCents",
  email: "emailCampaignMessageCostCents",
  transactional: "utilityMessageCostCents",
};

export const RATE_META: Record<RateKey, { label: string; kind: "campaign" | "transactional"; desc: string }> = {
  sms: { label: "SMS campaign", kind: "campaign", desc: "Per SMS sent in a marketing campaign." },
  whatsapp: { label: "WhatsApp campaign", kind: "campaign", desc: "Per WhatsApp message sent in a marketing campaign." },
  email: { label: "Email campaign", kind: "campaign", desc: "Per email sent in a marketing campaign." },
  transactional: {
    label: "Transactional message",
    kind: "transactional",
    desc: "Per booking confirmation / reminder once a plan's included allowance is used up, and for extra credits bought on plan-details.",
  },
};

export type PlatformSettingsPayload = {
  id?: string;
  stripeEnabled?: boolean | null;
  campaignMessageCostCents?: number | null;
  smsCampaignMessageCostCents?: number | null;
  whatsappCampaignMessageCostCents?: number | null;
  emailCampaignMessageCostCents?: number | null;
  utilityMessageCostCents?: number | null;
  smsChannelEnabled?: boolean | null;
  whatsappChannelEnabled?: boolean | null;
  emailChannelEnabled?: boolean | null;
  manualPaymentMethods?: unknown;
  updatedAt?: string;
  updatedBy?: string;
  [key: string]: unknown;
};

export type ResolvedChannel = {
  key: Channel;
  label: string;
  /** provider set up in the qrschedule.com environment */
  configured: boolean;
  /** admin override: true / false / null (follow environment) */
  override: boolean | null;
  /** effective: is this channel delivering customer messages right now */
  enabled: boolean;
};

export function resolveChannels(payload: PlatformSettingsPayload | null | undefined): ResolvedChannel[] {
  return CHANNELS.map((key) => {
    const raw = (payload ?? {})[CHANNEL_FIELD[key]];
    const override = raw === true || raw === false ? raw : null;
    const configured = isChannelProviderConfigured(key);
    return {
      key,
      label: CHANNEL_LABEL[key],
      configured,
      override,
      enabled: override === false ? false : configured,
    };
  });
}

export type RateSource = "override" | "default";

export type ResolvedRate = {
  key: RateKey;
  label: string;
  kind: "campaign" | "transactional";
  desc: string;
  /** Effective per-message cost in cents (what qrschedule.com actually charges). */
  effectiveCents: number;
  /** The system default this rate falls back to when the toggle is off. */
  defaultCents: number;
  /** The raw stored override (null when the toggle is off). */
  storedCents: number | null;
  /** true = admin override in effect; false = following the system default. */
  enabled: boolean;
  source: RateSource;
};

export type EffectiveMessagingPricing = {
  rates: ResolvedRate[];
  channels: ResolvedChannel[];
  updatedAt: string | null;
  updatedBy: string | null;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Resolve every rate the same way bookmysalon's getCampaignPricing() does. */
export function resolveEffectiveMessagingPricing(
  payload: PlatformSettingsPayload | null | undefined,
): EffectiveMessagingPricing {
  const legacyCampaign = num(payload?.campaignMessageCostCents) ?? DEFAULT_CAMPAIGN_MESSAGE_COST_CENTS;

  const rates: ResolvedRate[] = RATE_KEYS.map((key) => {
    const meta = RATE_META[key];
    const stored = num((payload ?? {})[RATE_FIELD[key]]);
    const defaultCents =
      meta.kind === "campaign" ? legacyCampaign : DEFAULT_UTILITY_MESSAGE_COST_CENTS;
    return {
      key,
      label: meta.label,
      kind: meta.kind,
      desc: meta.desc,
      effectiveCents: stored ?? defaultCents,
      defaultCents,
      storedCents: stored,
      enabled: stored !== null,
      source: stored !== null ? "override" : "default",
    };
  });

  return {
    rates,
    channels: resolveChannels(payload),
    updatedAt: typeof payload?.updatedAt === "string" ? payload.updatedAt : null,
    updatedBy: typeof payload?.updatedBy === "string" ? payload.updatedBy : null,
  };
}

export type RateInput = { enabled: boolean; cents: number };
/** Channel toggle from the editor: true = on (follow env), false = force off. */
export type ChannelInput = { enabled: boolean };

export type ValidateResult =
  | {
      ok: true;
      values: Record<RateKey, number | null>;
      channels: Record<Channel, boolean | null>;
    }
  | { ok: false; errors: string[] };

/**
 * Validate the editor payload. Each enabled rate must be a whole number of
 * cents >= 0 (a disabled rate => null). Each channel toggle => `false` to force
 * off, or `null` to follow the environment (we never write `true`, since an
 * admin cannot force a channel on past a missing provider).
 */
export function validateMessagingPricing(input: unknown): ValidateResult {
  const body = (input ?? {}) as { rates?: Record<string, unknown>; channels?: Record<string, unknown> };
  const rawRates = body.rates ?? {};
  const rawChannels = body.channels ?? {};
  const errors: string[] = [];
  const values = {} as Record<RateKey, number | null>;
  const channels = {} as Record<Channel, boolean | null>;

  for (const key of RATE_KEYS) {
    const entry = (rawRates as Record<string, RateInput | undefined>)[key];
    if (!entry || entry.enabled === false) {
      values[key] = null;
      continue;
    }
    const n = typeof entry.cents === "number" ? entry.cents : Number(entry.cents);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      errors.push(`${RATE_META[key].label} rate must be a whole number of cents ≥ 0.`);
      values[key] = null;
      continue;
    }
    values[key] = n;
  }

  for (const key of CHANNELS) {
    const entry = (rawChannels as Record<string, ChannelInput | undefined>)[key];
    // present + enabled:false => force off; otherwise clear the override.
    channels[key] = entry && entry.enabled === false ? false : null;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, values, channels };
}

/**
 * Merge the rate values and channel toggles into an existing `platform_settings`
 * payload, preserving every other field (stripeEnabled, manualPaymentMethods,
 * the legacy campaignMessageCostCents, ...) the way bookmysalon's `mergeAndSave`
 * does. A `null` value clears that rate's / channel's override.
 */
export function mergePricingIntoPayload(
  existing: PlatformSettingsPayload | null | undefined,
  values: Record<RateKey, number | null>,
  channels: Record<Channel, boolean | null>,
  updatedBy: string,
): PlatformSettingsPayload {
  const next: PlatformSettingsPayload = {
    ...(existing ?? {}),
    id: PLATFORM_SETTINGS_ROW_ID,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  for (const key of RATE_KEYS) {
    next[RATE_FIELD[key]] = values[key];
  }
  for (const key of CHANNELS) {
    next[CHANNEL_FIELD[key]] = channels[key];
  }
  return next;
}
