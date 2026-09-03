import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { safeErrorResponse } from "@/lib/http";
import {
  PLATFORM_SETTINGS_ROW_ID,
  resolveEffectiveMessagingPricing,
  type PlatformSettingsPayload,
} from "@/lib/messaging-pricing";
import {
  CATEGORIES,
  freshnessDays,
  rateSourceLabel,
  resolveRateForDate,
  rowToRecord,
  todayIso,
  validateProviderCost,
  type MessageCategory,
  type ProviderCostRecord,
  type ProviderCostRow,
} from "@/lib/provider-costs";
import { computeEconomics, customerMinorForCategory } from "@/lib/messaging-economics";

const TABLE = "provider_messaging_costs";

function isMissingTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  return /could not find the table|relation .* does not exist|schema cache/i.test(msg);
}

async function loadRecords(): Promise<{ records: ProviderCostRecord[]; tableReady: boolean }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("effective_from", { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return { records: [], tableReady: false };
    throw error;
  }
  return { records: ((data ?? []) as ProviderCostRow[]).map(rowToRecord), tableReady: true };
}

async function loadCustomerPricing() {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("payload")
    .eq("id", PLATFORM_SETTINGS_ROW_ID)
    .maybeSingle();
  if (error) throw error;
  const resolved = resolveEffectiveMessagingPricing((data?.payload as PlatformSettingsPayload) ?? null);
  const whatsapp = resolved.rates.find((r) => r.key === "whatsapp")!;
  const transactional = resolved.rates.find((r) => r.key === "transactional")!;
  return {
    whatsappCampaignMinor: whatsapp.effectiveCents,
    transactionalMinor: transactional.effectiveCents,
    updatedAt: resolved.updatedAt,
  };
}

function buildSummary(
  records: ProviderCostRecord[],
  customer: { whatsappCampaignMinor: number; transactionalMinor: number },
  opts: { provider: string; channel: string; country: string; onDate: string },
) {
  return CATEGORIES.filter((c) => c !== "service").map((category: MessageCategory) => {
    const rate = resolveRateForDate(
      records,
      { provider: opts.provider, channel: opts.channel, country: opts.country, category },
      opts.onDate,
    );
    const customerMinor = customerMinorForCategory(category, customer) ?? 0;
    const providerMinor = rate ? rate.costPerMessageMinor : null;
    return {
      category,
      customerMinor,
      economics: computeEconomics(customerMinor, providerMinor),
      rate: rate
        ? {
            id: rate.id,
            costPerMessageMinor: rate.costPerMessageMinor,
            currency: rate.currency,
            effectiveFrom: rate.effectiveFrom,
            sourceType: rate.sourceType,
            sourceUrl: rate.sourceUrl,
            notes: rate.notes,
          }
        : null,
      sourceLabel: rateSourceLabel(rate),
    };
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const provider = (searchParams.get("provider") || "meta").toLowerCase();
    const channel = (searchParams.get("channel") || "whatsapp").toLowerCase();
    const country = (searchParams.get("country") || "PK").toUpperCase();
    const onDate = todayIso();

    const [{ records, tableReady }, customer] = await Promise.all([loadRecords(), loadCustomerPricing()]);

    return NextResponse.json({
      rates: records,
      tableReady,
      summary: buildSummary(records, customer, { provider, channel, country, onDate }),
      customerPricing: {
        whatsappCampaignMinor: customer.whatsappCampaignMinor,
        transactionalMinor: customer.transactionalMinor,
        updatedAt: customer.updatedAt,
        currency: "PKR",
      },
      meta: {
        provider,
        channel,
        country,
        freshnessDays: freshnessDays(),
        liveSourceAvailable: false,
      },
    });
  } catch (error) {
    return safeErrorResponse("provider-messaging-costs GET", error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const result = validateProviderCost(body);
    if (!result.ok) {
      return NextResponse.json({ error: "Validation failed", errors: result.errors }, { status: 400 });
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const row: ProviderCostRow = {
      id,
      provider: result.value.provider,
      channel: result.value.channel,
      country: result.value.country,
      category: result.value.category,
      currency: result.value.currency,
      cost_per_message_minor: result.value.costPerMessageMinor,
      source_type: result.value.sourceType,
      source_url: result.value.sourceUrl,
      effective_from: result.value.effectiveFrom,
      effective_to: result.value.effectiveTo,
      status: result.value.status,
      notes: result.value.notes,
      fetched_at: null,
      created_at: now,
      updated_at: now,
      updated_by: auth.email,
    };

    const { error } = await supabase.from(TABLE).insert(row);
    if (error) throw error;

    await writeAuditLog({
      actor: auth.email,
      action: "provider_messaging_cost.created",
      entityType: "provider_messaging_cost",
      entityId: id,
      summary:
        `Added ${result.value.provider}/${result.value.channel} ${result.value.category} rate for ${result.value.country}: ` +
        `${(result.value.costPerMessageMinor / 100).toFixed(2)} ${result.value.currency}/msg ` +
        `(effective ${result.value.effectiveFrom}, source ${result.value.sourceType})`,
      before: null,
      after: rowToRecord(row),
    });

    return NextResponse.json({ data: rowToRecord(row) }, { status: 201 });
  } catch (error) {
    return safeErrorResponse("provider-messaging-costs POST", error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const { data: current, error: loadError } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (loadError) throw loadError;
    if (!current) return NextResponse.json({ error: "Rate not found" }, { status: 404 });
    const before = rowToRecord(current as ProviderCostRow);

    const action = typeof body?.action === "string" ? body.action : "";
    let patch: Partial<ProviderCostRow>;
    let auditAction: string;

    if (action === "activate" || action === "deactivate") {
      patch = { status: action === "activate" ? "active" : "inactive" };
      auditAction = `provider_messaging_cost.${action}d`;
    } else {
      // Full field edit - re-validate against the merged shape.
      const merged = {
        provider: body.provider ?? before.provider,
        channel: body.channel ?? before.channel,
        country: body.country ?? before.country,
        category: body.category ?? before.category,
        currency: body.currency ?? before.currency,
        costPerMessageMinor: body.costPerMessageMinor ?? before.costPerMessageMinor,
        sourceType: body.sourceType ?? before.sourceType,
        sourceUrl: body.sourceUrl ?? before.sourceUrl,
        effectiveFrom: body.effectiveFrom ?? before.effectiveFrom,
        effectiveTo: body.effectiveTo ?? before.effectiveTo ?? "",
        status: body.status ?? before.status,
        notes: body.notes ?? before.notes,
      };
      const result = validateProviderCost(merged);
      if (!result.ok) {
        return NextResponse.json({ error: "Validation failed", errors: result.errors }, { status: 400 });
      }
      patch = {
        provider: result.value.provider,
        channel: result.value.channel,
        country: result.value.country,
        category: result.value.category,
        currency: result.value.currency,
        cost_per_message_minor: result.value.costPerMessageMinor,
        source_type: result.value.sourceType,
        source_url: result.value.sourceUrl,
        effective_from: result.value.effectiveFrom,
        effective_to: result.value.effectiveTo,
        status: result.value.status,
        notes: result.value.notes,
      };
      auditAction = "provider_messaging_cost.updated";
    }

    patch.updated_at = new Date().toISOString();
    patch.updated_by = auth.email;

    const { data: updated, error } = await supabase.from(TABLE).update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;

    const after = rowToRecord(updated as ProviderCostRow);
    await writeAuditLog({
      actor: auth.email,
      action: auditAction,
      entityType: "provider_messaging_cost",
      entityId: id,
      summary: `${auditAction.split(".")[1]} ${before.provider}/${before.channel} ${before.category} rate for ${before.country}`,
      before,
      after,
    });

    return NextResponse.json({ data: after });
  } catch (error) {
    return safeErrorResponse("provider-messaging-costs PATCH", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const { data: current, error: loadError } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (loadError) throw loadError;
    if (!current) return NextResponse.json({ error: "Rate not found" }, { status: 404 });

    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (error) throw error;

    await writeAuditLog({
      actor: auth.email,
      action: "provider_messaging_cost.deleted",
      entityType: "provider_messaging_cost",
      entityId: id,
      summary: `Deleted provider rate ${id}`,
      before: rowToRecord(current as ProviderCostRow),
      after: null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeErrorResponse("provider-messaging-costs DELETE", error);
  }
}
