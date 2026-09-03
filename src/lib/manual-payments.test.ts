import { describe, expect, it } from "vitest";
import { displayStatus, isOpenForDecision, parseManualPaymentAction } from "./manual-payments";

describe("parseManualPaymentAction", () => {
  it("accepts a valid approve", () => {
    const r = parseManualPaymentAction({ id: "abc", type: "wallet_topup", action: "approve" });
    expect(r).toEqual({ ok: true, id: "abc", type: "wallet_topup", action: "approve", reason: "" });
  });

  it("accepts a valid reject and trims the reason", () => {
    const r = parseManualPaymentAction({
      id: "abc",
      type: "subscription",
      action: "reject",
      rejectionReason: "  bad proof  ",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reason).toBe("bad proof");
  });

  it("defaults a blank reject reason", () => {
    const r = parseManualPaymentAction({ id: "abc", type: "subscription", action: "reject" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reason).toBe("Rejected by admin");
  });

  it("rejects a missing id", () => {
    expect(parseManualPaymentAction({ type: "wallet_topup", action: "approve" }).ok).toBe(false);
  });

  it("rejects an unknown type", () => {
    expect(parseManualPaymentAction({ id: "a", type: "refund", action: "approve" }).ok).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(parseManualPaymentAction({ id: "a", type: "wallet_topup", action: "delete" }).ok).toBe(false);
  });

  it("rejects an over-long reason", () => {
    const r = parseManualPaymentAction({
      id: "a",
      type: "wallet_topup",
      action: "reject",
      rejectionReason: "x".repeat(1001),
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-object / empty body safely", () => {
    expect(parseManualPaymentAction(null).ok).toBe(false);
    expect(parseManualPaymentAction("nope").ok).toBe(false);
  });
});

describe("isOpenForDecision", () => {
  it("open for pending / pending_review (any case)", () => {
    expect(isOpenForDecision("pending")).toBe(true);
    expect(isOpenForDecision("pending_review")).toBe(true);
    expect(isOpenForDecision("PENDING_REVIEW")).toBe(true);
  });
  it("closed for approved / rejected / unknown / null", () => {
    expect(isOpenForDecision("approved")).toBe(false);
    expect(isOpenForDecision("rejected")).toBe(false);
    expect(isOpenForDecision("cancelled")).toBe(false);
    expect(isOpenForDecision(null)).toBe(false);
    expect(isOpenForDecision(undefined)).toBe(false);
  });
});

describe("displayStatus", () => {
  it("maps pending_review -> pending for the existing UI", () => {
    expect(displayStatus("pending_review")).toBe("pending");
    expect(displayStatus("pending")).toBe("pending");
  });
  it("passes other statuses through lower-cased", () => {
    expect(displayStatus("APPROVED")).toBe("approved");
    expect(displayStatus("rejected")).toBe("rejected");
  });
  it("defaults empty / null to pending", () => {
    expect(displayStatus(null)).toBe("pending");
    expect(displayStatus("")).toBe("pending");
  });
});
