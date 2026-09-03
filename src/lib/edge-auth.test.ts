import { afterEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { verifyAdminJwt } from "./edge-auth";

const SECRET = "edge-test-secret-aaaaaaaaaaaaaaaaaaaa";

afterEach(() => vi.unstubAllEnvs());

describe("verifyAdminJwt", () => {
  it("accepts a valid token signed the same way the app signs it (jsonwebtoken HS256)", async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    const token = jwt.sign({ email: "admin@example.com" }, SECRET, { expiresIn: "24h" });
    expect(await verifyAdminJwt(token)).toEqual({ email: "admin@example.com" });
  });

  it("rejects a missing token", async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    expect(await verifyAdminJwt(undefined)).toBeNull();
    expect(await verifyAdminJwt("")).toBeNull();
  });

  it("rejects an expired token", async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    const token = jwt.sign({ email: "admin@example.com" }, SECRET, { expiresIn: -10 });
    expect(await verifyAdminJwt(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    const token = jwt.sign({ email: "admin@example.com" }, "some-other-secret");
    expect(await verifyAdminJwt(token)).toBeNull();
  });

  it("rejects a malformed token", async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    expect(await verifyAdminJwt("not.a.jwt")).toBeNull();
    expect(await verifyAdminJwt("garbage")).toBeNull();
  });

  it("fails closed in production when JWT_SECRET is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "");
    const token = jwt.sign({ email: "admin@example.com" }, "anything");
    expect(await verifyAdminJwt(token)).toBeNull();
  });
});
