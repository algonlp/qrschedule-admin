/**
 * Minimal in-process rate limiter for the admin login endpoint.
 *
 * Scope note: state lives in this Node process's memory. On a single-instance
 * deployment (the current setup) that is enough to stop credential stuffing
 * from one machine. If the panel is ever run behind multiple instances /
 * serverless, move this to a shared store (Redis, Upstash, Postgres) - the
 * `RateLimiter` interface below is what a swap should keep.
 *
 * The admin account is NEVER permanently locked: a bucket auto-clears once its
 * window passes, and a SUCCESSFUL login clears the bucket immediately (call
 * `reset`).
 */

export type RateLimitResult = {
  allowed: boolean;
  /** Attempts still available in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window resets and attempts are available again. */
  retryAfterSeconds: number;
};

type Bucket = { count: number; firstAt: number };

export class RateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts?: { max?: number; windowMs?: number; now?: () => number }) {
    this.max = opts?.max ?? 5;
    this.windowMs = opts?.windowMs ?? 15 * 60 * 1000;
    this.now = opts?.now ?? Date.now;
  }

  /**
   * Record and evaluate one attempt for `key` (e.g. the client IP). Call this
   * on every attempt; call `reset(key)` after a successful login so a real
   * user is never held back by their own earlier typos.
   */
  check(key: string): RateLimitResult {
    const now = this.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now - bucket.firstAt >= this.windowMs) {
      this.buckets.set(key, { count: 1, firstAt: now });
      return { allowed: true, remaining: this.max - 1, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    const resetInMs = this.windowMs - (now - bucket.firstAt);
    const retryAfterSeconds = Math.max(1, Math.ceil(resetInMs / 1000));

    if (bucket.count > this.max) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: this.max - bucket.count, retryAfterSeconds };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Drop expired buckets. Optional housekeeping; safe to never call. */
  sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.firstAt >= this.windowMs) this.buckets.delete(key);
    }
  }
}

/**
 * Shared limiter for the login route: 5 failed attempts per IP per 15 minutes.
 * Module-level so it survives between requests within one instance.
 */
export const loginRateLimiter = new RateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

/** Best-effort client IP from proxy headers, falling back to a fixed bucket. */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
