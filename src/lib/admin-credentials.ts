import { timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

/**
 * Admin credential check for the single-operator QR Schedule Admin Panel.
 *
 * Config (env), in order of preference:
 *   ADMIN_EMAIL          - required. No fallback: if unset, every login fails.
 *   ADMIN_PASSWORD_HASH  - a bcrypt hash of the admin password (preferred).
 *   ADMIN_PASSWORD        - plaintext password (legacy). Still accepted so an
 *                           existing deploy keeps working, but logs a one-time
 *                           warning; generate a hash with `npx bcrypt-cli` or
 *                           `node -e "console.log(require('bcryptjs').hashSync(process.argv[1],12))" '<pw>'`.
 *
 * There are NO default credentials. A previous build fell back to
 * admin@qrschedule.com / admin123 - that is removed.
 *
 * The check is written to avoid leaking which half was wrong (email vs
 * password) and to keep response time roughly constant whether or not the
 * email matched, so the login endpoint cannot be used to enumerate the admin
 * address. The route must return ONE generic "invalid email or password".
 */

// A real bcrypt hash (cost 10) of a random string. Compared against when no
// password is configured or the email did not match, purely so those paths
// take about as long as a genuine comparison.
const DUMMY_HASH = "$2b$10$COxEFxt8UZh5PTZYQhJ0deDJ5MvKIBeEcXwgVgnIaQ10RG.DNgq/m";

export type AdminCredentialConfig = {
  email: string | undefined;
  passwordHash: string | undefined;
  password: string | undefined;
};

function readConfig(): AdminCredentialConfig {
  return {
    email: process.env.ADMIN_EMAIL?.trim() || undefined,
    passwordHash: process.env.ADMIN_PASSWORD_HASH?.trim() || undefined,
    password: process.env.ADMIN_PASSWORD ?? undefined,
  };
}

let warnedAboutPlaintext = false;

/** Constant-time string comparison that never short-circuits on length. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still run a compare of equal-length buffers so timing does not reveal
    // the length relationship.
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function verifyAdminCredentials(
  email: unknown,
  password: unknown,
  configOverride?: AdminCredentialConfig,
): Promise<boolean> {
  const config = configOverride ?? readConfig();

  const suppliedEmail = typeof email === "string" ? email.trim() : "";
  const suppliedPassword = typeof password === "string" ? password : "";

  const emailMatches =
    config.email !== undefined && suppliedEmail.length > 0 && safeEqual(suppliedEmail.toLowerCase(), config.email.toLowerCase());

  if (config.passwordHash) {
    const passwordMatches = await bcrypt.compare(suppliedPassword, config.passwordHash);
    return emailMatches && passwordMatches;
  }

  if (config.password !== undefined && config.password.length > 0) {
    if (!warnedAboutPlaintext && !configOverride) {
      console.warn(
        "[auth] ADMIN_PASSWORD is stored in plaintext. Set ADMIN_PASSWORD_HASH (bcrypt) instead.",
      );
      warnedAboutPlaintext = true;
    }
    // Equalise timing with the bcrypt path.
    await bcrypt.compare(suppliedPassword, DUMMY_HASH);
    const passwordMatches = safeEqual(suppliedPassword, config.password);
    return emailMatches && passwordMatches;
  }

  // No password configured at all - refuse every login, but keep the timing
  // shape of a real attempt.
  await bcrypt.compare(suppliedPassword, DUMMY_HASH);
  return false;
}

/** True when the panel has enough config to ever authenticate anyone. */
export function isAdminAuthConfigured(configOverride?: AdminCredentialConfig): boolean {
  const config = configOverride ?? readConfig();
  return Boolean(config.email && (config.passwordHash || (config.password && config.password.length > 0)));
}
