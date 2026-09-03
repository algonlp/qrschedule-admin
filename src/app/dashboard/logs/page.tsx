"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { CenteredSpinner, EmptyState, ErrorCard } from "@/components/ui/feedback";
import { SegmentedFilter } from "@/components/ui/DataTable";
import { cn } from "@/components/ui/utils";

type LogEntry = {
  id: string; type: string; created: string; salonName: string; customerEmail: string;
  customerName: string; amount: number | null; failureMessage: string | null; objectId: string;
};

const LABELS: Record<string, string> = {
  "charge.succeeded": "Payment Succeeded",
  "charge.failed": "Payment Failed",
  "charge.refunded": "Payment Refunded",
  "payment_intent.payment_failed": "Payment Intent Failed",
  "invoice.payment_failed": "Invoice Payment Failed",
  "customer.subscription.created": "Subscription Created",
  "customer.subscription.updated": "Subscription Updated",
  "customer.subscription.deleted": "Subscription Canceled",
  "customer.subscription.trial_will_end": "Trial Ending Soon",
};

const FILTERS = [
  { value: "all", label: "All events" },
  { value: "failed", label: "Failed" },
  { value: "payment", label: "Payments" },
  { value: "subscription", label: "Subscriptions" },
];

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch(`/api/stripe/logs?type=${filter}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else { setError(""); setLogs(data.data); }
      })
      .catch(() => setError("Failed to load logs"))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="space-y-5">
      <PageHeader title="Logs" description="Stripe payment and subscription events, newest first." />

      {error ? (
        <ErrorCard message={error} />
      ) : (
        <>
          <SegmentedFilter value={filter} onChange={(v) => { setLoading(true); setFilter(v); }} options={FILTERS} />

          <Card className="overflow-hidden">
            {loading ? (
              <CenteredSpinner />
            ) : logs.length === 0 ? (
              <EmptyState icon="logs" title="No events found" />
            ) : (
              <div className="divide-y divide-border">
                {logs.map((log) => {
                  const isFailed = log.type.includes("failed");
                  const isSuccess = log.type.includes("succeeded");
                  const isSub = log.type.includes("subscription");
                  return (
                    <div key={log.id} className={cn("px-4 py-3.5 flex items-start justify-between gap-4", isFailed && "bg-danger-soft/40")}>
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          className={cn(
                            "mt-1.5 w-2 h-2 rounded-full shrink-0",
                            isFailed ? "bg-danger" : isSuccess ? "bg-success" : isSub ? "bg-primary" : "bg-fg-subtle",
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-fg">{LABELS[log.type] || log.type}</p>
                          {log.salonName !== "N/A" && log.salonName !== log.customerName && (
                            <p className="text-sm text-primary font-medium mt-0.5">Salon: {log.salonName}</p>
                          )}
                          <p className="text-sm text-fg-muted mt-0.5">
                            {log.customerName !== "N/A" ? log.customerName : ""}{" "}
                            {log.customerEmail !== "N/A" && <span className="text-xs text-fg-subtle">({log.customerEmail})</span>}
                          </p>
                          {log.amount !== null && <p className="text-xs text-fg-muted mt-0.5 font-medium">Amount: ${log.amount.toFixed(2)}</p>}
                          {log.failureMessage && (
                            <p className="text-xs text-danger mt-1.5 bg-danger-soft border border-danger/20 px-2 py-1 rounded inline-block">
                              {log.failureMessage}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-fg-subtle">{new Date(log.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                        <p className="text-xs text-fg-subtle">{new Date(log.created).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
