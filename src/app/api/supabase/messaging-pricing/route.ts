import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import {
  PLATFORM_SETTINGS_ROW_ID,
  RATE_KEYS,
  RATE_META,
  mergePricingIntoPayload,
  resolveEffectiveMessagingPricing,
  validateMessagingPricing,
  type PlatformSettingsPayload,
} from "@/lib/messaging-pricing";

const TABLE = "platform_settings";

async function loadPayload(): Promise<PlatformSettingsPayload | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("payload")
    .eq("id", PLATFORM_SETTINGS_ROW_ID)
    .maybeSingle();
  if (error) throw error;
  return (data?.payload as PlatformSettingsPayload) ?? null;
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const payload = await loadPayload();
    return NextResponse.json({ data: resolveEffectiveMessagingPricing(payload) });
  } catch (error) {
    console.error("Messaging pricing load error:", error);
    return NextResponse.json({ error: "Failed to load messaging pricing" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const result = validateMessagingPricing(body);
    if (!result.ok) {
      return NextResponse.json({ error: "Validation failed", errors: result.errors }, { status: 400 });
    }

    const existing = await loadPayload();
    const before = resolveEffectiveMessagingPricing(existing);
    const nextPayload = mergePricingIntoPayload(existing, result.values, result.channels, auth.email);

    const { error } = await supabase
      .from(TABLE)
      .upsert({ id: PLATFORM_SETTINGS_ROW_ID, payload: nextPayload }, { onConflict: "id" });
    if (error) throw error;

    const after = resolveEffectiveMessagingPricing(nextPayload);

    const changes: string[] = [];
    for (const key of RATE_KEYS) {
      const b = before.rates.find((r) => r.key === key)!;
      const a = after.rates.find((r) => r.key === key)!;
      if (b.effectiveCents !== a.effectiveCents || b.enabled !== a.enabled) {
        changes.push(
          `${RATE_META[key].label} rate: ${b.effectiveCents}c (${b.enabled ? "custom" : "default"}) → ` +
            `${a.effectiveCents}c (${a.enabled ? "custom" : "default"})`,
        );
      }
    }
    for (const bc of before.channels) {
      const ac = after.channels.find((c) => c.key === bc.key)!;
      if (bc.enabled !== ac.enabled || bc.override !== ac.override) {
        changes.push(
          `${bc.label} channel: ${bc.enabled ? "on" : "off"} → ${ac.enabled ? "on" : "off"}` +
            `${ac.override === false ? " (forced off by admin)" : ""}`,
        );
      }
    }

    await writeAuditLog({
      actor: auth.email,
      action: "messaging_pricing.updated",
      entityType: "platform_settings",
      entityId: PLATFORM_SETTINGS_ROW_ID,
      summary:
        changes.length > 0
          ? `Messaging rates changed: ${changes.join("; ")}`
          : "Messaging rates re-saved unchanged",
      before: {
        rates: Object.fromEntries(before.rates.map((r) => [r.key, { cents: r.effectiveCents, enabled: r.enabled }])),
        channels: Object.fromEntries(before.channels.map((c) => [c.key, { enabled: c.enabled, override: c.override }])),
      },
      after: {
        rates: Object.fromEntries(after.rates.map((r) => [r.key, { cents: r.effectiveCents, enabled: r.enabled }])),
        channels: Object.fromEntries(after.channels.map((c) => [c.key, { enabled: c.enabled, override: c.override }])),
      },
    });

    return NextResponse.json({ data: after, changed: changes.length > 0, changes });
  } catch (error) {
    console.error("Messaging pricing update error:", error);
    return NextResponse.json({ error: "Failed to update messaging pricing" }, { status: 500 });
  }
}
