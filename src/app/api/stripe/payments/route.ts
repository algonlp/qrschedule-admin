import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { extractSalonName, parseSalonFromDescription } from "@/lib/salon";

type ExpandedCustomer = {
  id: string;
  name?: string | null;
  email?: string | null;
  metadata?: Record<string, string>;
  description?: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const startingAfter = searchParams.get("starting_after") || undefined;

    const params: Record<string, unknown> = { limit, expand: ["data.customer"] };
    if (startingAfter) params.starting_after = startingAfter;

    const charges = await stripe.charges.list(params as Parameters<typeof stripe.charges.list>[0]);

    const customerSubCache = new Map<string, string>();

    const data = await Promise.all(
      charges.data.map(async (charge) => {
        const customer = charge.customer as ExpandedCustomer | null;

        let salonName =
          extractSalonName(customer?.metadata) ||
          parseSalonFromDescription(customer?.description) ||
          null;

        if (!salonName && customer?.id) {
          if (customerSubCache.has(customer.id)) {
            salonName = customerSubCache.get(customer.id)!;
          } else {
            try {
              const subs = await stripe.subscriptions.list({
                customer: customer.id,
                limit: 1,
                status: "all",
              });
              for (const sub of subs.data) {
                const fromMeta = extractSalonName(sub.metadata);
                const fromDesc = parseSalonFromDescription(sub.description || undefined);
                if (fromMeta || fromDesc) {
                  salonName = (fromMeta || fromDesc)!;
                  break;
                }
              }
            } catch {
              // ignore
            }
            if (!salonName) {
              try {
                const sessions = await stripe.checkout.sessions.list({
                  customer: customer.id,
                  limit: 3,
                });
                for (const session of sessions.data) {
                  const fromMeta = extractSalonName(session.metadata);
                  if (fromMeta) {
                    salonName = fromMeta;
                    break;
                  }
                }
              } catch {
                // ignore
              }
            }
            customerSubCache.set(customer.id, salonName || "N/A");
          }
        }

        if (!salonName) salonName = customer?.name || charge.billing_details?.name || "N/A";

        return {
          id: charge.id,
          amount: charge.amount / 100,
          currency: charge.currency,
          status: charge.status,
          paid: charge.paid,
          refunded: charge.refunded,
          salonName,
          customerName: charge.billing_details?.name || customer?.name || "N/A",
          customerEmail: charge.billing_details?.email || charge.receipt_email || customer?.email || "N/A",
          description: charge.description || "N/A",
          created: new Date(charge.created * 1000).toISOString(),
          receiptUrl: charge.receipt_url,
          failureCode: charge.failure_code,
          failureMessage: charge.failure_message,
          paymentMethod: charge.payment_method_details?.type || "N/A",
        };
      })
    );

    return NextResponse.json({
      data,
      hasMore: charges.has_more,
      lastId: charges.data[charges.data.length - 1]?.id,
    });
  } catch (error) {
    console.error("Payments error:", error);
    return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 });
  }
}
