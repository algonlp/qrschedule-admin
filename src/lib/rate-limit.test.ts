import { describe, expect, it } from "vitest";
import { RateLimiter, clientIpFromHeaders } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows up to `max` attempts, then blocks", () => {
    const rl = new RateLimiter({ max: 3, windowMs: 1000, now: () => 0 });
    expect(rl.check("ip").allowed).toBe(true); // 1
    expect(rl.check("ip").allowed).toBe(true); // 2
    expect(rl.check("ip").allowed).toBe(true); // 3
    const blocked = rl.check("ip"); // 4
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("reports remaining attempts", () => {
    const rl = new RateLimiter({ max: 5, windowMs: 1000, now: () => 0 });
    expect(rl.check("ip").remaining).toBe(4);
    expect(rl.check("ip").remaining).toBe(3);
  });

  it("tracks keys independently", () => {
    const rl = new RateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(true);
  });

  it("resets after the window passes - the account is never permanently locked", () => {
    let now = 0;
    const rl = new RateLimiter({ max: 2, windowMs: 1000, now: () => now });
    rl.check("ip");
    rl.check("ip");
    expect(rl.check("ip").allowed).toBe(false);
    now = 1001;
    expect(rl.check("ip").allowed).toBe(true);
  });

  it("a successful login (reset) clears the bucket immediately", () => {
    const rl = new RateLimiter({ max: 2, windowMs: 100_000, now: () => 0 });
    rl.check("ip");
    rl.check("ip");
    expect(rl.check("ip").allowed).toBe(false);
    rl.reset("ip");
    expect(rl.check("ip").allowed).toBe(true);
  });

  it("sweep drops only expired buckets", () => {
    let now = 0;
    const rl = new RateLimiter({ max: 5, windowMs: 1000, now: () => now });
    rl.check("old");
    now = 500;
    rl.check("new");
    now = 1200;
    rl.sweep();
    // "old" expired and was swept => fresh window; "new" still counting.
    expect(rl.check("old").remaining).toBe(4);
    expect(rl.check("new").remaining).toBe(3);
  });
});

describe("clientIpFromHeaders", () => {
  it("takes the first x-forwarded-for entry", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIpFromHeaders(h)).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip then 'unknown'", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
