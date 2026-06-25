import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { extractSalonName, parseSalonFromDescription } from "@/lib/salon";

type ExpandedCustomer = {
  id: string;
  name?: string | null;
  email?: string | null;
  metadata?: Record<string, string>;
  description?: string | null;
};

function getSalonName(customer: ExpandedCustomer | null, billingName?: string | null): string {
  const fromMeta = extractSalonName(customer?.metadata);
  if (fromMeta) return fromMeta;
  if (customer?.description) {
    const fromDesc = parseSalonFromDescription(customer.description);
    if (fromDesc) return fromDesc;
    return customer.description;
  }
  if (customer?.name) return customer.name;
  if (billingName) return billingName;
  return "N/A";
}

export async function GET() {
  try {
    const [subscriptions, charges, customers] = await Promise.all([
      stripe.subscriptions.list({ limit: 100, status: "all" }),
      stripe.charges.list({ limit: 100, expand: ["data.customer"] }),
      stripe.customers.list({ limit: 100 }),
    ]);

    const activeSubscriptions = subscriptions.data.filter(
      (s) => s.status === "active" || s.status === "trialing"
    ).length;

    const totalRevenue = charges.data
      .filter((c) => c.status === "succeeded")
      .reduce((sum, c) => sum + c.amount, 0) / 100;

    const failedPayments = charges.data.filter((c) => c.status === "failed").length;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthlyRevenue = charges.data
      .filter((c) => c.status === "succeeded" && c.created * 1000 >= monthStart.getTime())
      .reduce((sum, c) => sum + c.amount, 0) / 100;

    const subMetaMap = new Map<string, string>();
    for (const sub of subscriptions.data) {
      const name = extractSalonName(sub.metadata) || parseSalonFromDescription(sub.description || undefined);
      if (name) {
        const custId = typeof sub.customer === "string" ? sub.customer : sub.customer?.toString();
        if (custId) subMetaMap.set(custId, name);
      }
    }

    const recentPayments = charges.data.slice(0, 5).map((charge) => {
      const customer = charge.customer as ExpandedCustomer | null;
      let salonName = getSalonName(customer, charge.billing_details?.name);
      if (salonName === "N/A" || salonName === customer?.name) {
        const custId = customer?.id;
        if (custId && subMetaMap.has(custId)) {
          salonName = subMetaMap.get(custId)!;
        }
      }

      return {
        id: charge.id,
        amount: charge.amount / 100,
        currency: charge.currency,
        status: charge.status,
        salonName,
        customerEmail: charge.billing_details?.email || charge.receipt_email || customer?.email || "N/A",
        customerName: charge.billing_details?.name || customer?.name || "N/A",
        created: new Date(charge.created * 1000).toISOString(),
        receiptUrl: charge.receipt_url,
        failureCode: charge.failure_code,
        failureMessage: charge.failure_message,
      };
    });

    return NextResponse.json({
      totalRevenue,
      monthlyRevenue,
      activeSubscriptions,
      totalCustomers: customers.data.length,
      failedPayments,
      totalCharges: charges.data.length,
      recentPayments,
    });
  } catch (error) {
    console.error("Stripe stats error:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
