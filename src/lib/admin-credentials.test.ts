import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { isAdminAuthConfigured, verifyAdminCredentials, type AdminCredentialConfig } from "./admin-credentials";

const HASH = bcrypt.hashSync("correct horse battery", 8);

const hashConfig: AdminCredentialConfig = {
  email: "admin@example.com",
  passwordHash: HASH,
  password: undefined,
};
const plaintextConfig: AdminCredentialConfig = {
  email: "admin@example.com",
  passwordHash: undefined,
  password: "correct horse battery",
};
const emptyConfig: AdminCredentialConfig = { email: undefined, passwordHash: undefined, password: undefined };

describe("verifyAdminCredentials - hashed password", () => {
  it("accepts the right email + password", async () => {
    expect(await verifyAdminCredentials("admin@example.com", "correct horse battery", hashConfig)).toBe(true);
  });
  it("is case-insensitive on the email", async () => {
    expect(await verifyAdminCredentials("ADMIN@example.com", "correct horse battery", hashConfig)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    expect(await verifyAdminCredentials("admin@example.com", "wrong", hashConfig)).toBe(false);
  });
  it("rejects a wrong email", async () => {
    expect(await verifyAdminCredentials("someone@example.com", "correct horse battery", hashConfig)).toBe(false);
  });
  it("rejects missing / non-string input", async () => {
    expect(await verifyAdminCredentials(undefined, undefined, hashConfig)).toBe(false);
    expect(await verifyAdminCredentials("", "", hashConfig)).toBe(false);
    expect(await verifyAdminCredentials(123, {}, hashConfig)).toBe(false);
  });
});

describe("verifyAdminCredentials - legacy plaintext password", () => {
  it("still works for a correct login", async () => {
    expect(await verifyAdminCredentials("admin@example.com", "correct horse battery", plaintextConfig)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    expect(await verifyAdminCredentials("admin@example.com", "nope", plaintextConfig)).toBe(false);
  });
});

describe("verifyAdminCredentials - nothing configured", () => {
  it("refuses every login", async () => {
    expect(await verifyAdminCredentials("admin@example.com", "anything", emptyConfig)).toBe(false);
    expect(await verifyAdminCredentials("", "", emptyConfig)).toBe(false);
  });
  it("no default admin@qrschedule.com / admin123 backdoor", async () => {
    expect(await verifyAdminCredentials("admin@qrschedule.com", "admin123", emptyConfig)).toBe(false);
  });
});

describe("isAdminAuthConfigured", () => {
  it("true with email + hash", () => expect(isAdminAuthConfigured(hashConfig)).toBe(true));
  it("true with email + plaintext", () => expect(isAdminAuthConfigured(plaintextConfig)).toBe(true));
  it("false with nothing", () => expect(isAdminAuthConfigured(emptyConfig)).toBe(false));
  it("false with email but no password", () =>
    expect(isAdminAuthConfigured({ email: "a@b.com", passwordHash: undefined, password: undefined })).toBe(false));
});
