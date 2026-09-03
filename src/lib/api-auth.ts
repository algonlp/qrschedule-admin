import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export type AdminSession = { email: string };

/**
 * Route-handler auth guard. Every `/api/**` route except `auth/login` and
 * `auth/logout` handles Stripe/Supabase data or mutations and must call this
 * first:
 *
 *   const auth = await requireAdmin();
 *   if (auth instanceof NextResponse) return auth;
 *   // ...use auth.email
 *
 * The dashboard pages already run behind the `admin_token` cookie (see
 * proxy/middleware), which the browser sends automatically on same-origin
 * fetches, so adding this check does not change the authenticated UX - it only
 * closes the hole for unauthenticated direct calls.
 */
export async function requireAdmin(): Promise<AdminSession | NextResponse> {
  const session = await getSession();

  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return { email: session.email };
}
