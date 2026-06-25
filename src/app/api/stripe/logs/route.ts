import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { extractSalonName, parseSalonFromDescription } from "@/lib/salon";

type CachedCustomer = {
  name: string;
  email: string;
  salonName: string;
};

async function resolveCustomer(
  customerId: string,
  cache: Map<string, CachedCustomer>,
): Promise<CachedCustomer | null> {
  if (cache.has(customerId)) return cache.get(customerId)!;

  try {
    const cust = await stripe.customers.retrieve(customerId);
    if ("deleted" in cust && cust.deleted) return null;

    let salonName = extractSalonName(cust.metadata) || parseSalonFromDescription(cust.description) || "";

    if (!salonName) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: customerId,
          limit: 5,
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
    }

    if (!salonName) {
      try {
        const sessions = await stripe.checkout.sessions.list({
          customer: customerId,
          limit: 5,
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

    const result: CachedCustomer = {
      name: cust.name || "N/A",
      email: cust.email || "N/A",
      salonName: salonName || "N/A",
    };
    cache.set(customerId, result);
    return result;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "all";
    const limit = parseInt(searchParams.get("limit") || "50");

    let types: string[] = [];
    if (type === "failed") {
      types = ["charge.failed", "payment_intent.payment_failed", "invoice.payment_failed"];
    } else if (type === "subscription") {
      types = [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.trial_will_end",
      ];
    } else if (type === "payment") {
      types = ["charge.succeeded", "charge.failed", "charge.refunded"];
    }

    const events = await stripe.events.list({
      limit,
      ...(types.length > 0 ? { types } : {}),
    });

    const customerCache = new Map<string, CachedCustomer>();

    const data = await Promise.all(
      events.data.map(async (event) => {
        const obj = event.data.object as unknown as Record<string, unknown>;

        let customerEmail = "N/A";
        let customerName = "N/A";
        let salonName = "N/A";
        let amount: number | null = null;

        if ("billing_details" in obj && obj.billing_details) {
          const billing = obj.billing_details as { email?: string; name?: string };
          customerEmail = billing.email || customerEmail;
          customerName = billing.name || customerName;
        }
        if ("customer_email" in obj) customerEmail = (obj.customer_email as string) || customerEmail;
        if ("customer_name" in obj) customerName = (obj.customer_name as string) || customerName;
        if ("amount" in obj) amount = (obj.amount as number) / 100;
        if ("amount_paid" in obj && !amount) amount = (obj.amount_paid as number) / 100;

        const objMeta = obj.metadata as Record<string, string> | undefined;
        const fromObjMeta = extractSalonName(objMeta);
        if (fromObjMeta) salonName = fromObjMeta;

        if (salonName === "N/A") {
          const objDesc = obj.description as string | undefined;
          const fromDesc = parseSalonFromDescription(objDesc);
          if (fromDesc) salonName = fromDesc;
        }

        const customerId = (obj.customer as string) || null;
        if (customerId && typeof customerId === "string") {
          const resolved = await resolveCustomer(customerId, customerCache);
          if (resolved) {
            if (salonName === "N/A") salonName = resolved.salonName;
            if (customerName === "N/A") customerName = resolved.name;
            if (customerEmail === "N/A") customerEmail = resolved.email;
          }
        }

        let failureMessage: string | null = null;
        if ("failure_message" in obj) failureMessage = obj.failure_message as string;
        if ("last_payment_error" in obj && obj.last_payment_error) {
          const payErr = obj.last_payment_error as { message?: string };
          failureMessage = payErr.message || failureMessage;
        }

        return {
          id: event.id,
          type: event.type,
          created: new Date(event.created * 1000).toISOString(),
          salonName,
          customerEmail,
          customerName,
          amount,
          failureMessage,
          objectId: obj.id as string,
        };
      })
    );

    return NextResponse.json({
      data,
      hasMore: events.has_more,
    });
  } catch (error) {
    console.error("Logs error:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
