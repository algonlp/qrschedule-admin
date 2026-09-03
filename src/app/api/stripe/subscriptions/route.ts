import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { extractSalonName, parseSalonFromDescription } from "@/lib/salon";
import { writeAuditLog } from "@/lib/audit";
import { safeErrorResponse } from "@/lib/http";

type ExpandedCustomer = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  metadata?: Record<string, string>;
  description?: string | null;
};

const APPROVAL_STATUS_KEY = "admin_approval_status";
const APPROVED_AT_KEY = "admin_approved_at";
const APPROVAL_SOURCE_KEY = "admin_approval_source";

function getApprovalStatus(status: string, metadata?: Record<string, string> | null) {
  const savedStatus = metadata?.[APPROVAL_STATUS_KEY];
  if (savedStatus === "approved" || savedStatus === "pending" || savedStatus === "rejected") {
    return savedStatus;
  }

  return status === "active" || status === "trialing" ? "pending" : "not_required";
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "all";
    const approval = searchParams.get("approval") || "all";
    const limit = parseInt(searchParams.get("limit") || "50");
    const startingAfter = searchParams.get("starting_after") || undefined;

    const params: Record<string, unknown> = { limit, expand: ["data.customer"] };
    if (status !== "all") params.status = status;
    if (startingAfter) params.starting_after = startingAfter;

    const [subscriptions, bizResult] = await Promise.all([
      stripe.subscriptions.list(params as Parameters<typeof stripe.subscriptions.list>[0]),
      supabase.from("businesses").select("id, business_name, email"),
    ]);

    const bizByEmail = new Map<string, { id: string; name: string }>();
    for (const b of bizResult.data || []) {
      if (b.email) {
        bizByEmail.set(b.email.toLowerCase(), { id: b.id, name: b.business_name || "Unnamed Salon" });
      }
    }

    const productCache = new Map<string, string>();

    const data = await Promise.all(
      subscriptions.data.map(async (sub) => {
        const customer = sub.customer as ExpandedCustomer | null;
        const priceItem = sub.items.data[0];
        const productId = typeof priceItem?.price?.product === "string" ? priceItem.price.product : null;

        let planName = "N/A";
        if (productId) {
          if (productCache.has(productId)) {
            planName = productCache.get(productId)!;
          } else {
            try {
              const product = await stripe.products.retrieve(productId);
              planName = product.name || "N/A";
              productCache.set(productId, planName);
            } catch {
              // ignore
            }
          }
        }

        const customerEmail = customer?.email || "N/A";
        const matchedBiz = customerEmail !== "N/A" ? bizByEmail.get(customerEmail.toLowerCase()) : null;

        const salonName =
          matchedBiz?.name ||
          extractSalonName(sub.metadata) ||
          parseSalonFromDescription(sub.description || undefined) ||
          extractSalonName(customer?.metadata) ||
          customer?.description ||
          customer?.name ||
          "N/A";

        const periodStart = (sub as unknown as Record<string, number>).current_period_start || priceItem?.current_period_start || sub.created;
        const periodEnd = (sub as unknown as Record<string, number>).current_period_end || priceItem?.current_period_end || sub.created;

        return {
          id: sub.id,
          customerId: customer?.id || "N/A",
          salonName,
          salonId: matchedBiz?.id || null,
          customerName: customer?.name || "N/A",
          customerEmail,
          customerPhone: customer?.phone || "N/A",
          status: sub.status,
          approvalStatus: getApprovalStatus(sub.status, sub.metadata),
          approvedAt: sub.metadata?.[APPROVED_AT_KEY] || null,
          planName,
          amount: (priceItem?.price?.unit_amount || 0) / 100,
          currency: priceItem?.price?.currency || "usd",
          interval: priceItem?.price?.recurring?.interval || "month",
          currentPeriodStart: new Date(periodStart * 1000).toISOString(),
          currentPeriodEnd: new Date(periodEnd * 1000).toISOString(),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          created: new Date(sub.created * 1000).toISOString(),
        };
      })
    );

    const filteredData = approval === "all" ? data : data.filter((sub) => sub.approvalStatus === approval);

    return NextResponse.json({
      data: filteredData,
      hasMore: subscriptions.has_more,
      lastId: subscriptions.data[subscriptions.data.length - 1]?.id,
    });
  } catch (error) {
    console.error("Subscriptions error:", error);
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const subscriptionId = typeof body.id === "string" ? body.id : "";
    const action = typeof body.action === "string" ? body.action : "";

    if (!subscriptionId) {
      return NextResponse.json({ error: "Subscription id is required" }, { status: 400 });
    }

    if (action !== "approve") {
      return NextResponse.json({ error: "Unsupported subscription action" }, { status: 400 });
    }

    const existing = await stripe.subscriptions.retrieve(subscriptionId);
    const priorApproval = existing.metadata?.[APPROVAL_STATUS_KEY] ?? "pending";
    if (priorApproval === "approved") {
      return NextResponse.json({
        id: existing.id,
        approvalStatus: "approved",
        approvedAt: existing.metadata?.[APPROVED_AT_KEY] ?? null,
        alreadyApproved: true,
      });
    }

    const approvedAt = new Date().toISOString();
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      metadata: {
        ...existing.metadata,
        [APPROVAL_STATUS_KEY]: "approved",
        [APPROVED_AT_KEY]: approvedAt,
        [APPROVAL_SOURCE_KEY]: "qrschedule_admin",
      },
    });

    await writeAuditLog({
      actor: auth.email,
      action: "stripe_subscription.approved",
      entityType: "stripe_subscription",
      entityId: subscription.id,
      summary: `Marked Stripe subscription ${subscription.id} as approved`,
      before: { approvalStatus: priorApproval },
      after: { approvalStatus: "approved", approvedAt },
    });

    return NextResponse.json({
      id: subscription.id,
      approvalStatus: "approved",
      approvedAt,
    });
  } catch (error) {
    return safeErrorResponse("stripe/subscriptions PATCH", error);
  }
}
