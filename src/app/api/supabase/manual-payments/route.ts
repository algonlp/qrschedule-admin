import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { safeErrorResponse } from "@/lib/http";
import { displayStatus, isOpenForDecision, parseManualPaymentAction } from "@/lib/manual-payments";
import {
  bookmysalon,
  isBookmysalonConfigured,
  BookmysalonApiError,
} from "@/lib/bookmysalon";

type Business = {
  id: string;
  business_name?: string | null;
  email?: string | null;
  business_phone_number?: string | null;
  mobile_number?: string | null;
};

type SubscriptionRequest = {
  id: string;
  business_id: string;
  plan_id: string | null;
  status: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type WalletTopupRequest = {
  id: string;
  business_id: string;
  amount_cents: number | null;
  payment_proof_data_url: string | null;
  transaction_reference: string | null;
  status: string;
  rejection_reason: string | null;
  payment_method: string | null;
  created_at: string;
  updated_at: string;
};

type SubscriptionPlan = {
  id: string;
  plan_key?: string | null;
  payload?: Record<string, unknown> | null;
};

function textFromPayload(payload: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!payload) return null;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/**
 * Amounts across the manual-payment tables are stored in MINOR UNITS (paisa):
 *   - wallet_topup_requests.amount_cents            (integer column)
 *   - subscription_payment_request_records.payload.amountCents  (built from
 *     plan.amountCents + *CostCents in bookmysalon billing.service.ts)
 * Read them as-is. No "is this rupees or paisa?" heuristic.
 */
function centsFromPayload(payload: Record<string, unknown> | null | undefined): number | null {
  if (!payload) return null;
  for (const key of ["amountCents", "amount_cents", "priceCents", "price_cents", "totalCents", "total_cents"]) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value));
  }
  return null;
}

function getPlanName(plan?: SubscriptionPlan | null) {
  if (!plan) return "Subscription";
  return (
    textFromPayload(plan.payload, ["name", "title", "label", "plan_name", "display_name"]) ||
    plan.plan_key ||
    "Subscription"
  );
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const [subscriptionResult, walletResult, businessResult, planResult] = await Promise.all([
      supabase
        .from("subscription_payment_request_records")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("wallet_topup_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("businesses").select("id, business_name, email, business_phone_number, mobile_number"),
      supabase.from("subscription_plan_records").select("id, plan_key, payload"),
    ]);

    if (subscriptionResult.error) throw subscriptionResult.error;
    if (walletResult.error) throw walletResult.error;
    if (businessResult.error) throw businessResult.error;
    if (planResult.error) throw planResult.error;

    const businesses = new Map<string, Business>();
    for (const business of (businessResult.data || []) as Business[]) businesses.set(business.id, business);

    const plans = new Map<string, SubscriptionPlan>();
    for (const plan of (planResult.data || []) as SubscriptionPlan[]) plans.set(plan.id, plan);

    const subscriptions = ((subscriptionResult.data || []) as SubscriptionRequest[]).map((request) => {
      const business = businesses.get(request.business_id);
      const plan = request.plan_id ? plans.get(request.plan_id) : null;
      return {
        id: request.id,
        type: "subscription" as const,
        businessId: request.business_id,
        salonName: business?.business_name || "Unnamed Salon",
        customerEmail: business?.email || "N/A",
        customerPhone: business?.business_phone_number || business?.mobile_number || "N/A",
        planId: request.plan_id,
        planName: getPlanName(plan),
        amountCents: centsFromPayload(request.payload),
        status: displayStatus(request.status),
        method: textFromPayload(request.payload, ["payment_method", "paymentMethod", "method", "bank_name"]) || "manual",
        reference: textFromPayload(request.payload, [
          "transaction_reference",
          "transactionReference",
          "reference",
          "trx_id",
          "transaction_id",
        ]),
        proofUrl: textFromPayload(request.payload, [
          "payment_proof_data_url",
          "paymentProofDataUrl",
          "payment_screenshot_url",
          "screenshot_url",
          "proof_url",
          "receipt_url",
          "image_url",
        ]),
        note: textFromPayload(request.payload, ["note", "message", "remarks"]),
        createdAt: request.created_at,
        updatedAt: request.updated_at,
      };
    });

    const walletTopups = ((walletResult.data || []) as WalletTopupRequest[]).map((request) => {
      const business = businesses.get(request.business_id);
      return {
        id: request.id,
        type: "wallet_topup" as const,
        businessId: request.business_id,
        salonName: business?.business_name || "Unnamed Salon",
        customerEmail: business?.email || "N/A",
        customerPhone: business?.business_phone_number || business?.mobile_number || "N/A",
        planId: null,
        planName: "Wallet Top-up",
        amountCents: request.amount_cents ?? null,
        status: displayStatus(request.status),
        method: request.payment_method || "manual",
        reference: request.transaction_reference,
        proofUrl: request.payment_proof_data_url,
        note: request.rejection_reason,
        createdAt: request.created_at,
        updatedAt: request.updated_at,
      };
    });

    const data = [...subscriptions, ...walletTopups].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json({ data, backendConfigured: isBookmysalonConfigured() });
  } catch (error) {
    return safeErrorResponse("manual-payments GET", error);
  }
}

/**
 * Approve / reject a manual payment.
 *
 * This route does NOT touch the wallet or subscription tables itself. It
 * forwards the decision to bookmysalon's super-admin API, which owns the
 * ledger and is idempotent (a second approve of an already-decided request is
 * a no-op there). We then write our own audit-log row.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let parsed;
  try {
    parsed = parseManualPaymentAction(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!parsed.ok) {
    return NextResponse.json({ error: "Validation failed", errors: parsed.errors }, { status: 400 });
  }
  const { id, type, action, reason } = parsed;

  if (!isBookmysalonConfigured()) {
    console.error("[manual-payments] BOOKMYSALON_API_URL / PLATFORM_SUPER_ADMIN_KEY not set - cannot process approvals.");
    return NextResponse.json(
      { error: "Payment approval is not available - the backend connection is not configured." },
      { status: 503 },
    );
  }

  const table = type === "wallet_topup" ? "wallet_topup_requests" : "subscription_payment_request_records";

  // Read the current row for the audit "before" state and a fast local reject
  // of an already-decided request. The backend is still the real gate.
  let beforeStatus: string | null = null;
  try {
    const { data, error } = await supabase.from(table).select("status").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Payment request not found" }, { status: 404 });
    beforeStatus = (data as { status: string }).status ?? null;
  } catch (error) {
    return safeErrorResponse("manual-payments PATCH (lookup)", error);
  }

  if (!isOpenForDecision(beforeStatus)) {
    return NextResponse.json(
      { error: "This payment request has already been processed.", status: displayStatus(beforeStatus) },
      { status: 409 },
    );
  }

  // Delegate to the backend.
  try {
    if (type === "wallet_topup") {
      if (action === "approve") await bookmysalon.approveWalletTopup(id, auth.email);
      else await bookmysalon.rejectWalletTopup(id, auth.email, reason);
    } else {
      if (action === "approve") await bookmysalon.approveSubscriptionPayment(id, auth.email);
      else await bookmysalon.rejectSubscriptionPayment(id, auth.email, reason);
    }
  } catch (error) {
    if (error instanceof BookmysalonApiError) {
      console.error("[manual-payments] backend approval failed", { id, type, action, status: error.status });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return safeErrorResponse("manual-payments PATCH (backend)", error);
  }

  const reviewedAt = new Date().toISOString();
  const nextStatus = action === "approve" ? "approved" : "rejected";

  await writeAuditLog({
    actor: auth.email,
    action: `manual_payment.${action}d`,
    entityType: type === "wallet_topup" ? "wallet_topup_request" : "subscription_payment_request",
    entityId: id,
    summary:
      `${action === "approve" ? "Approved" : "Rejected"} ${type === "wallet_topup" ? "wallet top-up" : "subscription payment"} ${id}` +
      (action === "reject" ? ` - reason: ${reason}` : ""),
    before: { status: displayStatus(beforeStatus) },
    after: { status: nextStatus, reviewedBy: auth.email, reviewedAt },
  });

  return NextResponse.json({ id, type, status: nextStatus, reviewedAt });
}
