import { afterEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { signToken, verifyToken } from "./auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signToken / verifyToken", () => {
  it("round-trips a valid token", () => {
    vi.stubEnv("JWT_SECRET", "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa");
    const token = signToken({ email: "admin@example.com" });
    const decoded = verifyToken(token);
    expect(decoded?.email).toBe("admin@example.com");
  });

  it("rejects a tampered token", () => {
    vi.stubEnv("JWT_SECRET", "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa");
    const token = signToken({ email: "admin@example.com" });
    const tampered = token.slice(0, -3) + (token.endsWith("A") ? "BBB" : "AAA");
    expect(verifyToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const foreign = jwt.sign({ email: "attacker@example.com" }, "some-other-secret", { expiresIn: "24h" });
    vi.stubEnv("JWT_SECRET", "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(verifyToken(foreign)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.stubEnv("JWT_SECRET", "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa");
    const expired = jwt.sign({ email: "admin@example.com" }, "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa", {
      expiresIn: -10,
    });
    expect(verifyToken(expired)).toBeNull();
  });

  it("rejects garbage input", () => {
    vi.stubEnv("JWT_SECRET", "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(verifyToken("not-a-jwt")).toBeNull();
    expect(verifyToken("")).toBeNull();
  });

  it("in production with no JWT_SECRET, signing throws and verifying fails closed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "");
    expect(() => signToken({ email: "admin@example.com" })).toThrow();
    expect(verifyToken("anything")).toBeNull();
  });

  it("a token minted with the dev fallback secret is not accepted in production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("JWT_SECRET", "");
    const devToken = signToken({ email: "admin@example.com" });
    expect(verifyToken(devToken)?.email).toBe("admin@example.com");

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "a-real-production-secret-xxxxxxxxxxxx");
    expect(verifyToken(devToken)).toBeNull();
  });
});
