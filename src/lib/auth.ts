import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

/**
 * Signing secret for the admin session cookie.
 *
 * There is deliberately NO production fallback. A predictable secret would let
 * anyone forge an admin session, so in production a missing/blank `JWT_SECRET`
 * is a hard failure: `signToken` throws (login returns a generic 500) and
 * `verifyToken` treats every token as invalid (the user is bounced to /login).
 * Authentication fails CLOSED rather than falling back to a guessable key.
 *
 * In development only, a fixed local secret is used so `npm run dev` works
 * without a .env just to sign in. Tokens minted with it are worthless in
 * production because that branch never runs there.
 *
 * The secret is read lazily (not at module load) so an unrelated route in a
 * misconfigured deploy still responds instead of the whole server crashing.
 */
const DEV_ONLY_SECRET = "dev-only-insecure-secret-not-used-in-production";

let warnedAboutMissingSecret = false;

class MissingJwtSecretError extends Error {
  readonly code = "JWT_SECRET_NOT_CONFIGURED";
  constructor() {
    super("JWT_SECRET is not configured");
  }
}

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    // Never echoed to a response - callers translate this into a generic error.
    throw new MissingJwtSecretError();
  }

  if (!warnedAboutMissingSecret) {
    console.warn(
      "[auth] JWT_SECRET is not set - using an insecure development-only secret. " +
        "Set JWT_SECRET (32+ random bytes) before deploying.",
    );
    warnedAboutMissingSecret = true;
  }
  return DEV_ONLY_SECRET;
}

export function signToken(payload: { email: string }) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "24h" });
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, getJwtSecret()) as { email: string };
  } catch {
    // Covers a tampered/expired token AND a missing secret in production:
    // in every case the session is simply not valid.
    return null;
  }
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  return verifyToken(token);
}
