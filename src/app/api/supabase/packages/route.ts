import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/api-auth";
import { writeAuditLog, describePlanChanges } from "@/lib/audit";
import {
  DEFAULT_ENTITLEMENTS,
  PLAN_FEATURE_CATALOG,
  planToRow,
  rowToPlan,
  validatePlan,
  type SubscriptionPlan,
} from "@/lib/plans";

const TABLE = "subscription_plan_records";
const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"];

type PlanRow = { id: string; plan_key: string; is_active: boolean; display_order: number; payload: SubscriptionPlan };

async function loadRows(): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, plan_key, is_active, display_order, payload")
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanRow[];
}

/** active/trialing subscriber count per plan_id, for the entitlement-change warning. */
async function loadActiveSubscriberCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("business_subscription_records")
    .select("plan_id, status")
    .in("status", ACTIVE_SUBSCRIPTION_STATUSES);
  if (error) {
    // Non-fatal: the editor still works, it just cannot show impact counts.
    console.warn("[packages] could not load subscriber counts:", error.message);
    return {};
  }
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const planId = (row as { plan_id: string }).plan_id;
    if (planId) counts[planId] = (counts[planId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Real subscriber-affecting entitlement / feature changes.
 *
 * The stored row can be missing entitlement fields (older rows predate them);
 * qrschedule.com backfills those from code defaults at read time, so the
 * EFFECTIVE value a subscriber sees is `{...DEFAULT_ENTITLEMENTS, ...stored}`.
 * Diff against that effective baseline so merely making an implicit default
 * explicit is not reported as an impactful change - only a genuine value shift
 * (a removed feature, a lowered cap, ...) trips the confirmation.
 */
function entitlementOrFeatureChanges(before: SubscriptionPlan, after: SubscriptionPlan): string[] {
  const changes: string[] = [];
  const beforeEnt = { ...DEFAULT_ENTITLEMENTS, ...(before.entitlements ?? {}) } as Record<string, unknown>;
  const afterEnt = { ...DEFAULT_ENTITLEMENTS, ...(after.entitlements ?? {}) } as Record<string, unknown>;
  for (const key of new Set([...Object.keys(beforeEnt), ...Object.keys(afterEnt)])) {
    const a = beforeEnt[key];
    const b = afterEnt[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      changes.push(`${key}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
  }
  return changes;
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const [rows, subscriberCounts] = await Promise.all([loadRows(), loadActiveSubscriberCounts()]);
    return NextResponse.json({
      data: rows.map((row) => rowToPlan(row)),
      subscriberCounts,
      featureCatalog: PLAN_FEATURE_CATALOG,
    });
  } catch (error) {
    console.error("Packages list error:", error);
    return NextResponse.json({ error: "Failed to load packages" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const rows = await loadRows();
    const existing = rows.map((row) => ({ id: row.id, key: row.plan_key }));

    const result = validatePlan(body?.plan ?? body, { isCreate: true, existing });
    if (!result.ok) {
      return NextResponse.json({ error: "Validation failed", errors: result.errors }, { status: 400 });
    }

    const row = planToRow(result.plan);
    const { error } = await supabase.from(TABLE).insert(row);
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "A package with that id or key already exists." }, { status: 409 });
      }
      throw error;
    }

    await writeAuditLog({
      actor: auth.email,
      action: "package.created",
      entityType: "subscription_plan",
      entityId: result.plan.id,
      summary: `Created package "${result.plan.name}" (${result.plan.key})`,
      before: null,
      after: result.plan,
    });

    return NextResponse.json({ data: result.plan }, { status: 201 });
  } catch (error) {
    console.error("Package create error:", error);
    return NextResponse.json({ error: "Failed to create package" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const id = String(body?.id ?? body?.plan?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Package id is required" }, { status: 400 });
    }

    const rows = await loadRows();
    const currentRow = rows.find((row) => row.id === id);
    if (!currentRow) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
    const before = rowToPlan(currentRow);
    const existing = rows.map((row) => ({ id: row.id, key: row.plan_key }));

    const result = validatePlan(
      { ...(body?.plan ?? body), id, createdAt: before.createdAt },
      { isCreate: false, existing, currentId: id },
    );
    if (!result.ok) {
      return NextResponse.json({ error: "Validation failed", errors: result.errors }, { status: 400 });
    }

    // Requirement G: entitlement / feature edits are evaluated live against
    // existing subscribers, so refuse the write until the admin has explicitly
    // acknowledged the impact.
    const impactChanges = entitlementOrFeatureChanges(before, result.plan);
    if (impactChanges.length > 0 && !body?.acknowledgeSubscriberImpact) {
      const counts = await loadActiveSubscriberCounts();
      const activeSubscribers = counts[id] ?? 0;
      return NextResponse.json(
        {
          error: "This change alters entitlements/features and affects existing subscribers.",
          requiresAcknowledgement: true,
          activeSubscribers,
          changes: impactChanges,
        },
        { status: 409 },
      );
    }

    const { error } = await supabase.from(TABLE).upsert(planToRow(result.plan), { onConflict: "id" });
    if (error) throw error;

    await writeAuditLog({
      actor: auth.email,
      action: impactChanges.length > 0 ? "package.entitlements_changed" : "package.updated",
      entityType: "subscription_plan",
      entityId: id,
      summary:
        `Updated package "${result.plan.name}" (${result.plan.key}): ` +
        describePlanChanges(before as unknown as Record<string, unknown>, result.plan as unknown as Record<string, unknown>).join("; "),
      before,
      after: result.plan,
    });

    return NextResponse.json({ data: result.plan });
  } catch (error) {
    console.error("Package update error:", error);
    return NextResponse.json({ error: "Failed to update package" }, { status: 500 });
  }
}
