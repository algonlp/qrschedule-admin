import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { stripe } from "@/lib/stripe";
import { safeErrorResponse } from "@/lib/http";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim();
  if (!email) {
    return NextResponse.json(
      { error: "Pass ?email=<customer email> to inspect a specific customer." },
      { status: 400 },
    );
  }

  try {
    const customers = await stripe.customers.list({ email, limit: 5 });

    const results = await Promise.all(
      customers.data.map(async (cust) => {
        const subs = await stripe.subscriptions.list({
          customer: cust.id,
          limit: 10,
          status: "all",
        });

        const charges = await stripe.charges.list({
          customer: cust.id,
          limit: 10,
        });

        const sessions = await stripe.checkout.sessions.list({
          customer: cust.id,
          limit: 10,
          expand: ["data.line_items"],
        });

        const paymentIntents = await stripe.paymentIntents.list({
          customer: cust.id,
          limit: 10,
        });

        return {
          customer: {
            id: cust.id,
            name: cust.name,
            email: cust.email,
            description: cust.description,
            metadata: cust.metadata,
          },
          subscriptions: subs.data.map((sub) => ({
            id: sub.id,
            status: sub.status,
            description: sub.description,
            metadata: sub.metadata,
          })),
          charges: charges.data.map((ch) => ({
            id: ch.id,
            status: ch.status,
            amount: ch.amount,
            description: ch.description,
            metadata: ch.metadata,
            billing_name: ch.billing_details?.name,
            failure_message: ch.failure_message,
          })),
          checkoutSessions: sessions.data.map((s) => ({
            id: s.id,
            status: s.status,
            metadata: s.metadata,
            subscription: s.subscription,
            payment_intent: s.payment_intent,
            lineItems: s.line_items?.data?.map((li) => ({
              description: li.description,
              productName: (li.price?.product as { name?: string })?.name,
            })),
          })),
          paymentIntents: paymentIntents.data.map((pi) => ({
            id: pi.id,
            status: pi.status,
            description: pi.description,
            metadata: pi.metadata,
          })),
        };
      })
    );

    return NextResponse.json({ results }, { status: 200 });
  } catch (error) {
    return safeErrorResponse("stripe/debug", error);
  }
}
