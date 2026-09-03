import { describe, expect, it } from "vitest";
import {
  CHANNEL_PROVIDER_CONFIGURED,
  DEFAULT_CAMPAIGN_MESSAGE_COST_CENTS,
  DEFAULT_UTILITY_MESSAGE_COST_CENTS,
  mergePricingIntoPayload,
  resolveChannels,
  resolveEffectiveMessagingPricing,
  validateMessagingPricing,
} from "./messaging-pricing";

const rate = (p: ReturnType<typeof resolveEffectiveMessagingPricing>, key: string) =>
  p.rates.find((r) => r.key === key)!;
const chan = (p: ReturnType<typeof resolveEffectiveMessagingPricing>, key: string) =>
  p.channels.find((c) => c.key === key)!;
const NO_CHANNELS = { sms: null, whatsapp: null, email: null } as const;

describe("resolveEffectiveMessagingPricing", () => {
  it("with nothing stored, every rate follows the system default", () => {
    const p = resolveEffectiveMessagingPricing(null);
    for (const key of ["sms", "whatsapp", "email"]) {
      expect(rate(p, key).effectiveCents).toBe(DEFAULT_CAMPAIGN_MESSAGE_COST_CENTS);
      expect(rate(p, key).enabled).toBe(false);
      expect(rate(p, key).source).toBe("default");
    }
    expect(rate(p, "transactional").effectiveCents).toBe(DEFAULT_UTILITY_MESSAGE_COST_CENTS);
    expect(rate(p, "transactional").enabled).toBe(false);
  });

  it("an existing row with only stripeEnabled still means all defaults", () => {
    const p = resolveEffectiveMessagingPricing({ id: "global", stripeEnabled: false });
    expect(rate(p, "sms").enabled).toBe(false);
    expect(rate(p, "sms").effectiveCents).toBe(DEFAULT_CAMPAIGN_MESSAGE_COST_CENTS);
  });

  it("a per-channel override is honoured; the others stay on default", () => {
    const p = resolveEffectiveMessagingPricing({ smsCampaignMessageCostCents: 1200 });
    expect(rate(p, "sms").effectiveCents).toBe(1200);
    expect(rate(p, "sms").enabled).toBe(true);
    expect(rate(p, "whatsapp").effectiveCents).toBe(DEFAULT_CAMPAIGN_MESSAGE_COST_CENTS);
    expect(rate(p, "email").enabled).toBe(false);
  });

  it("campaign channels without their own override inherit the legacy campaign rate", () => {
    const p = resolveEffectiveMessagingPricing({ campaignMessageCostCents: 3000 });
    expect(rate(p, "sms").effectiveCents).toBe(3000);
    expect(rate(p, "whatsapp").effectiveCents).toBe(3000);
    expect(rate(p, "email").effectiveCents).toBe(3000);
    // the transactional default is unaffected by the campaign legacy rate
    expect(rate(p, "transactional").effectiveCents).toBe(DEFAULT_UTILITY_MESSAGE_COST_CENTS);
  });

  it("null is treated as no override", () => {
    const p = resolveEffectiveMessagingPricing({
      smsCampaignMessageCostCents: null,
      utilityMessageCostCents: null,
    });
    expect(rate(p, "sms").enabled).toBe(false);
    expect(rate(p, "transactional").enabled).toBe(false);
  });
});

describe("resolveChannels", () => {
  it("with no override, a channel is enabled iff its provider is configured", () => {
    const chans = resolveChannels(null);
    for (const c of chans) {
      expect(c.override).toBeNull();
      expect(c.configured).toBe(CHANNEL_PROVIDER_CONFIGURED[c.key]);
      expect(c.enabled).toBe(CHANNEL_PROVIDER_CONFIGURED[c.key]);
    }
  });
  it("an explicit false override forces a configured channel off", () => {
    const p = resolveEffectiveMessagingPricing({ smsChannelEnabled: false });
    expect(chan(p, "sms").override).toBe(false);
    expect(chan(p, "sms").enabled).toBe(false);
    expect(chan(p, "email").enabled).toBe(CHANNEL_PROVIDER_CONFIGURED.email);
  });
});

describe("validateMessagingPricing", () => {
  it("a disabled rate becomes null regardless of its number", () => {
    const r = validateMessagingPricing({
      rates: { sms: { enabled: false, cents: 999 }, transactional: { enabled: true, cents: 700 } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.sms).toBeNull();
    expect(r.values.transactional).toBe(700);
  });
  it("rejects a negative / fractional enabled rate", () => {
    expect(validateMessagingPricing({ rates: { sms: { enabled: true, cents: -1 } } }).ok).toBe(false);
    expect(validateMessagingPricing({ rates: { whatsapp: { enabled: true, cents: 19.5 } } }).ok).toBe(false);
  });
  it("missing rates default to null (disabled)", () => {
    const r = validateMessagingPricing({ rates: {} });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toEqual({ sms: null, whatsapp: null, email: null, transactional: null });
  });
  it("a channel toggle off => false, on/absent => null (never force true)", () => {
    const r = validateMessagingPricing({
      channels: { sms: { enabled: false }, whatsapp: { enabled: true }, email: {} },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.channels).toEqual({ sms: false, whatsapp: null, email: null });
  });
});

describe("mergePricingIntoPayload", () => {
  it("writes rate + channel fields and preserves everything else", () => {
    const existing = {
      id: "global",
      stripeEnabled: true,
      campaignMessageCostCents: 1900,
      manualPaymentMethods: { jazzcash: { instructions: "x" } },
      futureField: 7,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const merged = mergePricingIntoPayload(
      existing,
      { sms: 1500, whatsapp: null, email: 2000, transactional: 650 },
      { sms: null, whatsapp: false, email: null },
      "admin@qrschedule.com",
    );
    expect(merged.smsCampaignMessageCostCents).toBe(1500);
    expect(merged.whatsappCampaignMessageCostCents).toBeNull();
    expect(merged.emailCampaignMessageCostCents).toBe(2000);
    expect(merged.utilityMessageCostCents).toBe(650);
    expect(merged.whatsappChannelEnabled).toBe(false);
    expect(merged.smsChannelEnabled).toBeNull();
    expect(merged.stripeEnabled).toBe(true);
    expect(merged.campaignMessageCostCents).toBe(1900);
    expect(merged.manualPaymentMethods).toEqual({ jazzcash: { instructions: "x" } });
    expect(merged.futureField).toBe(7);
    expect(merged.updatedBy).toBe("admin@qrschedule.com");
    expect(merged.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("a full all-null save (every toggle off) is a valid no-op cutover", () => {
    const merged = mergePricingIntoPayload(
      { id: "global", stripeEnabled: false },
      { sms: null, whatsapp: null, email: null, transactional: null },
      { ...NO_CHANNELS },
      "admin@qrschedule.com",
    );
    const resolved = resolveEffectiveMessagingPricing(merged);
    expect(resolved.rates.every((r) => !r.enabled)).toBe(true);
    expect(resolved.channels.every((c) => c.override === null)).toBe(true);
    expect(rate(resolved, "sms").effectiveCents).toBe(DEFAULT_CAMPAIGN_MESSAGE_COST_CENTS);
    expect(rate(resolved, "transactional").effectiveCents).toBe(DEFAULT_UTILITY_MESSAGE_COST_CENTS);
  });
});
