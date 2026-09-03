import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { stripe } from "@/lib/stripe";
import { parseSalonFromDescription } from "@/lib/salon";
import { writeAuditLog } from "@/lib/audit";
import { safeErrorResponse } from "@/lib/http";

/**
 * Maintenance: backfill `businessName` (and `businessId` when found) onto Stripe
 * customer metadata by scanning their checkout sessions / subscriptions.
 *
 * Safe by default: with no body (or `{ "apply": false }`) this is a DRY RUN -
 * it reports what it WOULD change and writes nothing to Stripe. Pass
 * `{ "apply": true }` to actually update customer metadata; that path is
 * audit-logged.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let apply = false;
  try {
    const body = await request.json().catch(() => ({}));
    apply = body?.apply === true;
  } catch {
    apply = false;
  }

  try {
    const planned: { customerId: string; businessName: string; businessId: string | null }[] = [];
    let scanned = 0;
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const customers = await stripe.customers.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const cust of customers.data) {
        scanned++;
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
          if (session.metadata?.businessId) businessId = session.metadata.businessId;

          for (const item of session.line_items?.data || []) {
            const parsed = parseSalonFromDescription(item.description || "");
            if (parsed) {
              businessName = parsed;
              break;
            }
          }
          if (businessName) break;
        }

        if (!businessName) {
          const subs = await stripe.subscriptions.list({ customer: cust.id, limit: 5, status: "all" });
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
          planned.push({ customerId: cust.id, businessName, businessId });
          if (apply) {
            await stripe.customers.update(cust.id, {
              metadata: {
                ...cust.metadata,
                ...(businessId ? { businessId } : {}),
                businessName,
              },
            });
          }
        }
      }

      hasMore = customers.has_more;
      if (customers.data.length > 0) startingAfter = customers.data[customers.data.length - 1].id;
    }

    if (apply && planned.length > 0) {
      await writeAuditLog({
        actor: auth.email,
        action: "stripe.customers.backfill_metadata",
        entityType: "stripe_customer",
        entityId: `${planned.length} customers`,
        summary: `Backfilled businessName on ${planned.length} Stripe customer(s) (scanned ${scanned})`,
        after: planned,
      });
    }

    return NextResponse.json({
      dryRun: !apply,
      scanned,
      matched: planned.length,
      updated: apply ? planned.length : 0,
      customers: planned,
    });
  } catch (error) {
    return safeErrorResponse("stripe/fix-customers", error);
  }
}
