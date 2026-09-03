import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookmysalon,
  isBookmysalonConfigured,
  BookmysalonApiError,
} from "./bookmysalon";

const CONFIG = { BOOKMYSALON_API_URL: "https://api.example.com/", PLATFORM_SUPER_ADMIN_KEY: "super-secret-key" };

function stubConfig() {
  vi.stubEnv("BOOKMYSALON_API_URL", CONFIG.BOOKMYSALON_API_URL);
  vi.stubEnv("PLATFORM_SUPER_ADMIN_KEY", CONFIG.PLATFORM_SUPER_ADMIN_KEY);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isBookmysalonConfigured", () => {
  it("false when either env var is missing", () => {
    vi.stubEnv("BOOKMYSALON_API_URL", "https://api.example.com");
    vi.stubEnv("PLATFORM_SUPER_ADMIN_KEY", "");
    expect(isBookmysalonConfigured()).toBe(false);
  });
  it("true when both are set", () => {
    stubConfig();
    expect(isBookmysalonConfigured()).toBe(true);
  });
});

describe("bookmysalon.approveWalletTopup", () => {
  it("POSTs to the right URL with the super-admin headers and actor", async () => {
    stubConfig();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ topupRequest: { status: "approved" } }), { status: 200 }));

    await bookmysalon.approveWalletTopup("topup 1", "admin@example.com");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/super-admin/wallet/topup-requests/topup%201/approve");
    expect(opts.method).toBe("POST");
    expect(opts.headers["x-super-admin-key"]).toBe("super-secret-key");
    expect(opts.headers["x-super-admin-actor"]).toBe("admin@example.com");
  });

  it("throws BookmysalonApiError (not configured) when env is missing", async () => {
    await expect(bookmysalon.approveWalletTopup("t1", "a@b.com")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a 404 to a generic not-found error", async () => {
    stubConfig();
    fetchMock.mockResolvedValue(new Response("relation \"x\" blah", { status: 404 }));
    await expect(bookmysalon.approveWalletTopup("t1", "a@b.com")).rejects.toMatchObject({
      code: "BOOKMYSALON_API_ERROR",
      status: 404,
    });
  });

  it("maps a 403 (bad key) to a 502 without leaking", async () => {
    stubConfig();
    fetchMock.mockResolvedValue(new Response("bad key", { status: 403 }));
    await expect(bookmysalon.approveWalletTopup("t1", "a@b.com")).rejects.toMatchObject({ status: 502 });
  });

  it("maps a network failure to a 502", async () => {
    stubConfig();
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    let err: unknown;
    try {
      await bookmysalon.approveWalletTopup("t1", "a@b.com");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BookmysalonApiError);
    expect((err as BookmysalonApiError).status).toBe(502);
    expect((err as BookmysalonApiError).message).not.toContain("ECONNREFUSED");
  });
});

describe("bookmysalon.rejectSubscriptionPayment", () => {
  it("sends the reason in the body to the billing endpoint", async () => {
    stubConfig();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await bookmysalon.rejectSubscriptionPayment("req1", "admin@example.com", "blurry proof");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/super-admin/billing/manual-payment-requests/req1/reject");
    expect(JSON.parse(opts.body)).toEqual({ reason: "blurry proof" });
  });
});
