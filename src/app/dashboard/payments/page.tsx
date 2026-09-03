"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { downloadCSV } from "@/lib/export";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, ErrorCard, CenteredSpinner } from "@/components/ui/feedback";
import { Table, THead, TH, TBody, TR, TD, SegmentedFilter } from "@/components/ui/DataTable";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/Toast";
import { FormField, Textarea } from "@/components/ui/form";

type Payment = {
  id: string; amount: number; currency: string; status: string; paid: boolean; refunded: boolean;
  salonName: string; customerName: string; customerEmail: string; description: string; created: string;
  receiptUrl: string | null; failureMessage: string | null; paymentMethod: string;
};
type ManualPayment = {
  id: string; type: "subscription" | "wallet_topup"; businessId: string; salonName: string;
  customerEmail: string; customerPhone: string; planName: string; amountCents: number | null;
  status: string; method: string; reference: string | null; proofUrl: string | null; note: string | null;
  createdAt: string; updatedAt: string;
};

const formatCents = (c: number | null) =>
  !c ? "—" : `Rs ${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function PaymentsPage() {
  const [view, setView] = useState<"manual" | "stripe">("manual");
  const [manual, setManual] = useState<ManualPayment[]>([]);
  const [stripe, setStripe] = useState<Payment[]>([]);
  const [manualLoading, setManualLoading] = useState(true);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [manualError, setManualError] = useState("");
  const [stripeError, setStripeError] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ManualPayment | null>(null);
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const loadManual = useCallback(() => {
    fetch("/api/supabase/manual-payments")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setManualError(d.error);
        else { setManualError(""); setManual(d.data); }
      })
      .catch(() => setManualError("Failed to load manual payments"))
      .finally(() => setManualLoading(false));
  }, []);

  useEffect(() => {
    loadManual();
    const timer = window.setInterval(() => {
      if (!document.hidden) loadManual();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [loadManual]);

  useEffect(() => {
    fetch("/api/stripe/payments")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setStripeError(d.error);
        else setStripe(d.data);
      })
      .catch(() => setStripeError("Failed to load payments"))
      .finally(() => setStripeLoading(false));
  }, []);

  async function runAction(payment: ManualPayment, action: "approve" | "reject", rejectionReason?: string) {
    setActionId(payment.id);
    try {
      const res = await fetch("/api/supabase/manual-payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: payment.id, type: payment.type, action, rejectionReason }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to update");
      setManual((cur) => cur.map((i) => (i.id === payment.id ? { ...i, status: data.status, updatedAt: data.reviewedAt } : i)));
      toast.success(action === "approve" ? "Payment approved." : "Payment rejected.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update payment");
    } finally {
      setActionId(null);
    }
  }

  async function onApprove(payment: ManualPayment) {
    const yes = await confirm({
      title: "Approve this payment?",
      body: (
        <div className="space-y-1">
          <p>This activates the {payment.type === "wallet_topup" ? "wallet top-up" : "subscription"} on the backend and cannot be automatically reversed.</p>
          <p className="text-fg font-medium">{payment.salonName} · {formatCents(payment.amountCents)}</p>
        </div>
      ),
      confirmLabel: "Approve payment",
    });
    if (yes) runAction(payment, "approve");
  }

  const activeError = view === "manual" ? manualError : stripeError;
  const activeLoading = view === "manual" ? manualLoading : stripeLoading;

  function exportCsv() {
    if (view === "manual") {
      downloadCSV(
        manual.map((p) => ({
          Salon: p.salonName, Email: p.customerEmail, Type: p.type === "subscription" ? "Subscription" : "Wallet Top-up",
          Plan: p.planName, Amount: formatCents(p.amountCents), Method: p.method, Reference: p.reference || "",
          Status: p.status, Date: new Date(p.createdAt).toLocaleDateString(),
        })),
        "manual-payments",
      );
    } else {
      downloadCSV(
        stripe.map((p) => ({
          Salon: p.salonName, Email: p.customerEmail, Description: p.description,
          Amount: `$${p.amount.toFixed(2)} ${p.currency.toUpperCase()}`, Method: p.paymentMethod,
          Status: p.refunded ? "Refunded" : p.status, Date: new Date(p.created).toLocaleDateString(),
          "Failure Reason": p.failureMessage || "",
        })),
        "payments",
      );
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        description="Manual (Raast / bank) payment requests awaiting review, and the Stripe payment ledger."
        actions={
          <Button variant="secondary" size="sm" onClick={exportCsv}>
            <Icon name="download" className="w-3.5 h-3.5" />
            Export
          </Button>
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <SegmentedFilter
          value={view}
          onChange={setView}
          options={[
            { value: "manual", label: `Manual requests${manual.filter((m) => m.status === "pending").length ? ` · ${manual.filter((m) => m.status === "pending").length}` : ""}` },
            { value: "stripe", label: "Stripe payments" },
          ]}
        />
        {view === "manual" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
            </span>
            Auto-refreshing
          </span>
        )}
      </div>

      {activeError ? (
        <ErrorCard message={activeError} onRetry={view === "manual" ? loadManual : undefined} />
      ) : (
        <Card className="overflow-hidden">
          {activeLoading ? (
            <CenteredSpinner />
          ) : view === "manual" ? (
            manual.length === 0 ? (
              <EmptyState icon="payments" title="No manual payment requests" description="Requests submitted from qrschedule.com appear here for review." />
            ) : (
              <Table>
                <THead>
                  <TH>Salon</TH>
                  <TH>Request</TH>
                  <TH align="right">Amount</TH>
                  <TH>Proof</TH>
                  <TH>Status</TH>
                  <TH>Date</TH>
                  <TH align="right">Action</TH>
                </THead>
                <TBody>
                  {manual.map((p) => (
                    <TR key={`${p.type}-${p.id}`}>
                      <TD>
                        <Link href={`/dashboard/salons/${p.businessId}`} className="text-sm font-medium text-primary hover:underline">
                          {p.salonName}
                        </Link>
                        <p className="text-xs text-fg-subtle">{p.customerEmail}</p>
                      </TD>
                      <TD>
                        <p className="text-sm text-fg">{p.type === "subscription" ? "Subscription" : "Wallet Top-up"}</p>
                        <p className="text-xs text-fg-subtle">{p.planName}</p>
                        {p.reference && <p className="text-xs text-fg-subtle">Ref: {p.reference}</p>}
                      </TD>
                      <TD align="right" className="font-semibold text-fg">{formatCents(p.amountCents)}</TD>
                      <TD>
                        {p.proofUrl ? (
                          <a href={p.proofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.proofUrl} alt="Payment proof" className="h-11 w-11 rounded-lg object-cover border border-border" />
                            <span className="text-sm text-primary hover:underline">View</span>
                          </a>
                        ) : (
                          <span className="text-sm text-fg-subtle">No image</span>
                        )}
                      </TD>
                      <TD>
                        <StatusBadge status={p.status} dot />
                        {p.note && <p className="text-xs text-fg-subtle mt-1 max-w-[12rem] truncate">{p.note}</p>}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </TD>
                      <TD align="right">
                        {p.status === "pending" ? (
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" variant="success" loading={actionId === p.id} onClick={() => onApprove(p)}>
                              Approve
                            </Button>
                            <Button size="sm" variant="secondary" disabled={actionId === p.id} onClick={() => setRejecting(p)}>
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-sm text-fg-subtle">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )
          ) : stripe.length === 0 ? (
            <EmptyState icon="payments" title="No Stripe payments" />
          ) : (
            <Table>
              <THead>
                <TH>Salon</TH>
                <TH>Description</TH>
                <TH align="right">Amount</TH>
                <TH>Method</TH>
                <TH>Status</TH>
                <TH>Date</TH>
                <TH>Receipt</TH>
              </THead>
              <TBody>
                {stripe.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <p className="text-sm font-medium text-fg">{p.salonName}</p>
                      <p className="text-xs text-fg-subtle">{p.customerEmail}</p>
                    </TD>
                    <TD className="max-w-[14rem] truncate">{p.description}</TD>
                    <TD align="right" className="font-semibold text-fg">${p.amount.toFixed(2)} {p.currency.toUpperCase()}</TD>
                    <TD className="capitalize">{p.paymentMethod}</TD>
                    <TD>
                      <StatusBadge status={p.refunded ? "refunded" : p.status} dot />
                      {p.failureMessage && <p className="text-xs text-danger mt-1 max-w-[12rem]">{p.failureMessage}</p>}
                    </TD>
                    <TD className="whitespace-nowrap">
                      {new Date(p.created).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </TD>
                    <TD>
                      {p.receiptUrl ? (
                        <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm font-medium">View</a>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {rejecting && (
        <RejectModal
          key={rejecting.id}
          payment={rejecting}
          busy={actionId !== null}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => {
            const p = rejecting;
            setRejecting(null);
            runAction(p, "reject", reason);
          }}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function RejectModal({
  payment,
  busy,
  onClose,
  onConfirm,
}: {
  payment: ManualPayment;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title="Reject payment request"
      description={`${payment.salonName} · ${formatCents(payment.amountCents)}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="danger" size="sm" loading={busy} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim() || "Rejected by admin")}>
            Reject payment
          </Button>
        </>
      }
    >
      <FormField label="Reason for rejection" hint="Shared with the salon by email.">
        <Textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Payment proof is unclear / amount does not match"
          autoFocus
        />
      </FormField>
    </Modal>
  );
}
