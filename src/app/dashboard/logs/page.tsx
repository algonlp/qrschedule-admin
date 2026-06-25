"use client";

import { useEffect, useState } from "react";

type LogEntry = {
  id: string;
  type: string;
  created: string;
  salonName: string;
  customerEmail: string;
  customerName: string;
  amount: number | null;
  failureMessage: string | null;
  objectId: string;
};

const eventLabels: Record<string, string> = {
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

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stripe/logs?type=${filter}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setLogs(data.data);
      })
      .catch(() => setError("Failed to load logs"))
      .finally(() => setLoading(false));
  }, [filter]);

  const filters = [
    { label: "All Events", value: "all" },
    { label: "Failed Payments", value: "failed" },
    { label: "Payment Events", value: "payment" },
    { label: "Subscription Events", value: "subscription" },
  ];

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p className="text-red-700 font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              filter === f.value
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map((log) => {
              const isFailed = log.type.includes("failed");
              const isSuccess = log.type.includes("succeeded");
              const isSubscription = log.type.includes("subscription");

              return (
                <div
                  key={log.id}
                  className={`px-5 py-4 hover:bg-gray-50 ${isFailed ? "bg-red-50/40" : ""}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 ${
                          isFailed ? "bg-red-500" : isSuccess ? "bg-emerald-500" : isSubscription ? "bg-blue-500" : "bg-gray-400"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          {eventLabels[log.type] || log.type}
                        </p>
                        {log.salonName !== "N/A" && log.salonName !== log.customerName && (
                          <p className="text-sm text-blue-700 font-medium mt-0.5">
                            Salon: {log.salonName}
                          </p>
                        )}
                        <p className="text-sm text-gray-700 mt-0.5">
                          {log.customerName !== "N/A" ? log.customerName : ""}{" "}
                          <span className="text-xs text-gray-500">
                            {log.customerEmail !== "N/A" ? `(${log.customerEmail})` : ""}
                          </span>
                        </p>
                        {log.amount !== null && (
                          <p className="text-xs text-gray-600 mt-0.5 font-medium">
                            Amount: ${log.amount.toFixed(2)}
                          </p>
                        )}
                        {log.failureMessage && (
                          <p className="text-xs text-red-600 mt-1.5 bg-red-50 border border-red-100 px-2.5 py-1.5 rounded inline-block">
                            Reason: {log.failureMessage}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-500">
                        {new Date(log.created).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(log.created).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            {logs.length === 0 && (
              <div className="px-5 py-12 text-center text-gray-400">No events found</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
