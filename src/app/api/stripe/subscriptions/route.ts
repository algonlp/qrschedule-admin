import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { extractSalonName, parseSalonFromDescription } from "@/lib/salon";

type ExpandedCustomer = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  metadata?: Record<string, string>;
  description?: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "all";
    const limit = parseInt(searchParams.get("limit") || "50");
    const startingAfter = searchParams.get("starting_after") || undefined;

    const params: Record<string, unknown> = { limit, expand: ["data.customer", "data.items.data.price.product"] };
    if (status !== "all") params.status = status;
    if (startingAfter) params.starting_after = startingAfter;

    const subscriptions = await stripe.subscriptions.list(params as Parameters<typeof stripe.subscriptions.list>[0]);

    const data = subscriptions.data.map((sub) => {
      const customer = sub.customer as ExpandedCustomer | null;
      const priceItem = sub.items.data[0];
      const product = priceItem?.price?.product as { name?: string } | null;

      let salonName =
        extractSalonName(sub.metadata) ||
        parseSalonFromDescription(sub.description || undefined) ||
        extractSalonName(customer?.metadata) ||
        customer?.description ||
        customer?.name ||
        "N/A";

      return {
        id: sub.id,
        customerId: customer?.id || "N/A",
        salonName,
        customerName: customer?.name || "N/A",
        customerEmail: customer?.email || "N/A",
        customerPhone: customer?.phone || "N/A",
        status: sub.status,
        planName: product?.name || "N/A",
        amount: (priceItem?.price?.unit_amount || 0) / 100,
        currency: priceItem?.price?.currency || "usd",
        interval: priceItem?.price?.recurring?.interval || "month",
        currentPeriodStart: new Date((priceItem?.current_period_start || sub.created) * 1000).toISOString(),
        currentPeriodEnd: new Date((priceItem?.current_period_end || sub.created) * 1000).toISOString(),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        created: new Date(sub.created * 1000).toISOString(),
      };
    });

    return NextResponse.json({
      data,
      hasMore: subscriptions.has_more,
      lastId: subscriptions.data[subscriptions.data.length - 1]?.id,
    });
  } catch (error) {
    console.error("Subscriptions error:", error);
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
  }
}
