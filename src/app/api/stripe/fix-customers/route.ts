import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { parseSalonFromDescription } from "@/lib/salon";

export async function POST() {
  try {
    let fixed = 0;
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const customers = await stripe.customers.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const cust of customers.data) {
        if (cust.metadata?.businessName) continue;

        let businessName: string | null = null;
        let businessId: string | null = null;

        const sessions = await stripe.checkout.sessions.list({
          customer: cust.id,
          limit: 5,
          expand: ["data.line_items"],
        });

        for (const session of sessions.data) {
          if (session.metadata?.businessName) {
            businessName = session.metadata.businessName;
            businessId = session.metadata.businessId || null;
            break;
          }

          if (session.metadata?.businessId) {
            businessId = session.metadata.businessId;
          }

          const lineItems = session.line_items?.data || [];
          for (const item of lineItems) {
            const productName = item.description || "";
            const parsed = parseSalonFromDescription(productName);
            if (parsed) {
              businessName = parsed;
              break;
            }
          }
          if (businessName) break;
        }

        if (!businessName) {
          const subs = await stripe.subscriptions.list({
            customer: cust.id,
            limit: 5,
            status: "all",
          });

          for (const sub of subs.data) {
            if (sub.metadata?.businessName) {
              businessName = sub.metadata.businessName;
              businessId = businessId || sub.metadata.businessId || null;
              break;
            }
            const fromDesc = parseSalonFromDescription(sub.description || undefined);
            if (fromDesc) {
              businessName = fromDesc;
              businessId = businessId || sub.metadata?.businessId || null;
              break;
            }
          }
        }

        if (businessName) {
          await stripe.customers.update(cust.id, {
            metadata: {
              ...cust.metadata,
              ...(businessId ? { businessId } : {}),
              businessName,
            },
          });
          fixed++;
        }
      }

      hasMore = customers.has_more;
      if (customers.data.length > 0) {
        startingAfter = customers.data[customers.data.length - 1].id;
      }
    }

    return NextResponse.json({ success: true, fixedCustomers: fixed });
  } catch (error) {
    console.error("Fix customers error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
