/**
 * Server-side validation for the manual-payment approve/reject action.
 *
 * The route itself only ever forwards a request id + decision to the backend
 * (see src/lib/bookmysalon.ts) - it never computes a balance or an amount - so
 * validation here is about rejecting malformed input, not money maths.
 */

export const MANUAL_PAYMENT_TYPES = ["wallet_topup", "subscription"] as const;
export type ManualPaymentType = (typeof MANUAL_PAYMENT_TYPES)[number];

export const MANUAL_PAYMENT_ACTIONS = ["approve", "reject"] as const;
export type ManualPaymentAction = (typeof MANUAL_PAYMENT_ACTIONS)[number];

/**
 * Statuses that are still open for a decision. A request already `approved` /
 * `rejected` must not be re-processed - the backend enforces this too
 * (idempotent), this is the fast local reject.
 */
export const OPEN_STATUSES = ["pending", "pending_review"] as const;

export type ParsedManualPaymentAction =
  | {
      ok: true;
      id: string;
      type: ManualPaymentType;
      action: ManualPaymentAction;
      /** Trimmed reason; always present for `reject`, empty string for `approve`. */
      reason: string;
    }
  | { ok: false; errors: string[] };

export function parseManualPaymentAction(input: unknown): ParsedManualPaymentAction {
  const body = (input ?? {}) as Record<string, unknown>;
  const errors: string[] = [];

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) errors.push("A payment request id is required.");
  if (id.length > 200) errors.push("Payment request id is too long.");

  const type = body.type as ManualPaymentType;
  if (!MANUAL_PAYMENT_TYPES.includes(type)) {
    errors.push(`type must be one of: ${MANUAL_PAYMENT_TYPES.join(", ")}.`);
  }

  const action = body.action as ManualPaymentAction;
  if (!MANUAL_PAYMENT_ACTIONS.includes(action)) {
    errors.push(`action must be one of: ${MANUAL_PAYMENT_ACTIONS.join(", ")}.`);
  }

  let reason = "";
  if (action === "reject") {
    reason = typeof body.rejectionReason === "string" ? body.rejectionReason.trim() : "";
    if (!reason) reason = "Rejected by admin";
    if (reason.length > 1000) errors.push("Rejection reason is too long.");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, id, type, action, reason };
}

/** True when a request in this status can still be approved/rejected. */
export function isOpenForDecision(status: string | null | undefined): boolean {
  return OPEN_STATUSES.includes(String(status ?? "").toLowerCase() as (typeof OPEN_STATUSES)[number]);
}

/** Normalise a stored status to what the existing dashboard UI expects. */
export function displayStatus(status: string | null | undefined): "pending" | "approved" | "rejected" | string {
  const s = String(status ?? "").toLowerCase();
  if (s === "pending_review" || s === "pending") return "pending";
  return s || "pending";
}
