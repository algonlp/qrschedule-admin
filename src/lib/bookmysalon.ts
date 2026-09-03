/**
 * Thin client for the bookmysalon (qrschedule.com backend) super-admin API.
 *
 * The admin panel does NOT re-implement wallet or subscription accounting.
 * Manual-payment approval/rejection is delegated to the backend, which owns
 * the ledger and is already idempotent:
 *   - walletService.approveTopup()      (status guard: pending_review only)
 *   - billingService.approveManualSubscriptionPayment()
 *
 * Config (env), both required for the delegated calls to work:
 *   BOOKMYSALON_API_URL       - base URL of the backend, e.g. https://api.qrschedule.com
 *   PLATFORM_SUPER_ADMIN_KEY  - shared secret, MUST equal the backend's env value.
 *                               Sent as the `x-super-admin-key` header; never logged,
 *                               never returned to the browser.
 *
 * When either is missing, `isBookmysalonConfigured()` is false and callers
 * should return a 503 rather than attempting a local money mutation.
 */

const TIMEOUT_MS = 15_000;

export type BackendConfig = { baseUrl: string; superAdminKey: string };

export class BookmysalonNotConfiguredError extends Error {
  readonly code = "BOOKMYSALON_NOT_CONFIGURED";
  constructor() {
    super("Backend approval is not configured (BOOKMYSALON_API_URL / PLATFORM_SUPER_ADMIN_KEY).");
  }
}

export class BookmysalonApiError extends Error {
  readonly code = "BOOKMYSALON_API_ERROR";
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function readConfig(): Partial<BackendConfig> {
  return {
    baseUrl: process.env.BOOKMYSALON_API_URL?.trim().replace(/\/+$/, "") || undefined,
    superAdminKey: process.env.PLATFORM_SUPER_ADMIN_KEY?.trim() || undefined,
  };
}

export function isBookmysalonConfigured(): boolean {
  const cfg = readConfig();
  return Boolean(cfg.baseUrl && cfg.superAdminKey);
}

function requireConfig(): BackendConfig {
  const cfg = readConfig();
  if (!cfg.baseUrl || !cfg.superAdminKey) throw new BookmysalonNotConfiguredError();
  return cfg as BackendConfig;
}

async function post(path: string, actor: string, body?: unknown): Promise<unknown> {
  const cfg = requireConfig();
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-super-admin-key": cfg.superAdminKey,
        "x-super-admin-actor": actor,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Network / timeout - never expose the raw cause.
    throw new BookmysalonApiError(
      error instanceof Error && error.name === "TimeoutError"
        ? "The backend did not respond in time."
        : "Could not reach the backend.",
      502,
    );
  }

  if (!res.ok) {
    // The backend's own error text may reference internals - map to a generic
    // message, keep only the status.
    const message =
      res.status === 403
        ? "Backend rejected the super-admin key."
        : res.status === 404
          ? "The payment request was not found on the backend."
          : `Backend returned ${res.status}.`;
    throw new BookmysalonApiError(message, res.status === 403 ? 502 : res.status);
  }

  try {
    return await res.json();
  } catch {
    return {};
  }
}

export const bookmysalon = {
  approveWalletTopup(topupId: string, actor: string) {
    return post(`/super-admin/wallet/topup-requests/${encodeURIComponent(topupId)}/approve`, actor);
  },
  rejectWalletTopup(topupId: string, actor: string, reason: string) {
    return post(`/super-admin/wallet/topup-requests/${encodeURIComponent(topupId)}/reject`, actor, { reason });
  },
  approveSubscriptionPayment(requestId: string, actor: string) {
    return post(`/super-admin/billing/manual-payment-requests/${encodeURIComponent(requestId)}/approve`, actor);
  },
  rejectSubscriptionPayment(requestId: string, actor: string, reason: string) {
    return post(`/super-admin/billing/manual-payment-requests/${encodeURIComponent(requestId)}/reject`, actor, { reason });
  },
};
