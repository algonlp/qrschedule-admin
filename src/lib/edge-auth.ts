import { jwtVerify } from "jose";

/**
 * Edge-runtime JWT verification for `middleware.ts`.
 *
 * `jsonwebtoken` (used in src/lib/auth.ts on the Node runtime) does not run on
 * the edge, so the middleware verifies the same HS256 token with `jose`.
 * Same secret rules as src/lib/auth.ts: no production fallback - a missing
 * `JWT_SECRET` in production makes every token invalid (fail closed).
 */
const DEV_ONLY_SECRET = "dev-only-insecure-secret-not-used-in-production";

function getSecretBytes(): Uint8Array | null {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) return new TextEncoder().encode(configured);
  if (process.env.NODE_ENV === "production") return null;
  return new TextEncoder().encode(DEV_ONLY_SECRET);
}

/** Returns the token payload when valid & unexpired, otherwise null. */
export async function verifyAdminJwt(token: string | undefined): Promise<{ email: string } | null> {
  if (!token) return null;
  const secret = getSecretBytes();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return typeof payload.email === "string" ? { email: payload.email } : null;
  } catch {
    return null;
  }
}
