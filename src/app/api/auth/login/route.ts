import { NextRequest, NextResponse } from "next/server";
import { signToken } from "@/lib/auth";
import { verifyAdminCredentials, isAdminAuthConfigured } from "@/lib/admin-credentials";
import { loginRateLimiter, clientIpFromHeaders } from "@/lib/rate-limit";

// One generic message for every failure mode, so the endpoint cannot be used
// to tell "wrong email" from "wrong password" or to enumerate the admin address.
const GENERIC_AUTH_ERROR = "Invalid email or password";

export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);

  const limit = loginRateLimiter.check(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let email: unknown;
  let password: unknown;
  try {
    const body = await request.json();
    email = body?.email;
    password = body?.password;
  } catch {
    return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
  }

  if (!isAdminAuthConfigured()) {
    console.error("[auth/login] No admin credentials configured (ADMIN_EMAIL + ADMIN_PASSWORD_HASH or ADMIN_PASSWORD).");
    return NextResponse.json({ error: "Authentication is not available." }, { status: 503 });
  }

  let ok = false;
  try {
    ok = await verifyAdminCredentials(email, password);
  } catch (error) {
    console.error("[auth/login] credential check failed", error);
    return NextResponse.json({ error: "Authentication is not available." }, { status: 503 });
  }

  if (!ok) {
    return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
  }

  let token: string;
  try {
    token = signToken({ email: String(email).trim() });
  } catch (error) {
    // Missing JWT_SECRET in production lands here.
    console.error("[auth/login] could not sign session token", error);
    return NextResponse.json({ error: "Authentication is not available." }, { status: 503 });
  }

  // Successful login - clear this IP's failed-attempt bucket.
  loginRateLimiter.reset(ip);

  const response = NextResponse.json({ success: true });
  response.cookies.set("admin_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
  });

  return response;
}
