import { NextRequest, NextResponse } from "next/server";
import { verifyAdminJwt } from "@/lib/edge-auth";

/**
 * Gate for the dashboard UI. The token is now VERIFIED (signature + expiry),
 * not merely checked for presence - a tampered, expired or foreign token no
 * longer reaches a dashboard page. API routes have their own `requireAdmin()`
 * check and are intentionally not matched here (that would also catch the
 * public /api/auth/* routes).
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get("admin_token")?.value;
  const { pathname } = request.nextUrl;
  const session = await verifyAdminJwt(token);

  if (pathname.startsWith("/dashboard") && !session) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    // Clear a stale/invalid cookie so the browser stops resending it.
    if (token) response.cookies.set("admin_token", "", { maxAge: 0, path: "/" });
    return response;
  }

  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login"],
};
