"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { downloadCSV } from "@/lib/export";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { CenteredSpinner, EmptyState, ErrorCard } from "@/components/ui/feedback";
import { Table, THead, TH, TBody, TR, TD, SegmentedFilter } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/overlay";

type Subscription = {
  id: string; customerId: string; salonName: string; salonId: string | null; customerName: string;
  customerEmail: string; customerPhone: string; status: string; approvalStatus: string; approvedAt: string | null;
  planName: string; amount: number; currency: string; interval: string; currentPeriodStart: string;
  currentPeriodEnd: string; cancelAtPeriodEnd: boolean; created: string;
};

const STATUS_FILTERS = [
  { value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "trialing", label: "Trialing" },
  { value: "past_due", label: "Past due" }, { value: "canceled", label: "Canceled" },
];
const APPROVAL_FILTERS = [
  { value: "all", label: "All approvals" }, { value: "pending", label: "Pending" }, { value: "approved", label: "Approved" },
];

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    fetch(`/api/stripe/subscriptions?status=${filter}&approval=${approvalFilter}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else { setError(""); setSubs(data.data); }
      })
      .catch(() => setError("Failed to load subscriptions"))
      .finally(() => setLoading(false));
  }, [filter, approvalFilter]);

  useEffect(() => { load(); }, [load]);

  async function approve(sub: Subscription) {
    const yes = await confirm({
      title: "Approve this subscription?",
      body: <p>Marks <strong className="text-fg">{sub.salonName}</strong>&rsquo;s {sub.planName} subscription as approved.</p>,
      confirmLabel: "Approve",
    });
    if (!yes) return;
    setApprovingId(sub.id);
    try {
      const res = await fetch("/api/stripe/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sub.id, action: "approve" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to approve");
      setSubs((cur) =>
        approvalFilter === "pending"
          ? cur.filter((s) => s.id !== sub.id)
          : cur.map((s) => (s.id === sub.id ? { ...s, approvalStatus: "approved", approvedAt: data.approvedAt || new Date().toISOString() } : s)),
      );
      toast.success("Subscription approved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Subscriptions"
        description="Stripe subscriptions across all salons, with manual approval tracking."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              downloadCSV(
                subs.map((s) => ({
                  Salon: s.salonName, Email: s.customerEmail, Phone: s.customerPhone, Plan: s.planName,
                  Amount: `$${s.amount.toFixed(2)}/${s.interval}`, Status: s.status, Approval: s.approvalStatus.replace("_", " "),
                  Started: new Date(s.currentPeriodStart).toLocaleDateString(), Expires: new Date(s.currentPeriodEnd).toLocaleDateString(),
                })),
                "subscriptions",
              )
            }
          >
            <Icon name="download" className="w-3.5 h-3.5" />
            Export
          </Button>
        }
      />

      {error ? (
        <ErrorCard message={error} onRetry={() => { setError(""); setLoading(true); load(); }} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <SegmentedFilter value={filter} onChange={(v) => { setLoading(true); setFilter(v); }} options={STATUS_FILTERS} />
            <SegmentedFilter value={approvalFilter} onChange={(v) => { setLoading(true); setApprovalFilter(v); }} options={APPROVAL_FILTERS} />
          </div>

          <Card className="overflow-hidden">
            {loading ? (
              <CenteredSpinner />
            ) : subs.length === 0 ? (
              <EmptyState icon="subscriptions" title="No subscriptions found" />
            ) : (
              <Table>
                <THead>
                  <TH>Salon</TH><TH>Plan</TH><TH align="right">Amount</TH><TH>Status</TH><TH>Approval</TH><TH>Started</TH><TH>Expires</TH><TH align="right">Action</TH>
                </THead>
                <TBody>
                  {subs.map((sub) => (
                    <TR key={sub.id}>
                      <TD>
                        {sub.salonId ? (
                          <Link href={`/dashboard/salons/${sub.salonId}`} className="text-sm font-medium text-primary hover:underline">{sub.salonName}</Link>
                        ) : (
                          <p className="text-sm font-medium text-fg">{sub.salonName}</p>
                        )}
                        <p className="text-xs text-fg-subtle">{sub.customerEmail}</p>
                      </TD>
                      <TD className="text-fg">{sub.planName}</TD>
                      <TD align="right" className="font-semibold text-fg">${sub.amount.toFixed(2)}/{sub.interval}</TD>
                      <TD><StatusBadge status={sub.cancelAtPeriodEnd && sub.status === "active" ? "canceled" : sub.status} dot /></TD>
                      <TD>
                        <StatusBadge status={sub.approvalStatus === "not_required" ? "unknown" : sub.approvalStatus} />
                        {sub.approvedAt && <p className="text-xs text-fg-subtle mt-1">{new Date(sub.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>}
                      </TD>
                      <TD className="whitespace-nowrap">{new Date(sub.currentPeriodStart).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</TD>
                      <TD className="whitespace-nowrap">{new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</TD>
                      <TD align="right">
                        {sub.approvalStatus === "pending" ? (
                          <Button size="sm" variant="success" loading={approvingId === sub.id} onClick={() => approve(sub)}>Approve</Button>
                        ) : (
                          <span className="text-sm text-fg-subtle">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
