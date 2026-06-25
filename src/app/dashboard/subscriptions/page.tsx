"use client";

import { useEffect, useState } from "react";

type Subscription = {
  id: string;
  customerId: string;
  salonName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  status: string;
  planName: string;
  amount: number;
  currency: string;
  interval: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  created: string;
};

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stripe/subscriptions?status=${filter}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setSubscriptions(data.data);
      })
      .catch(() => setError("Failed to load subscriptions"))
      .finally(() => setLoading(false));
  }, [filter]);

  const statusFilters = [
    { label: "All", value: "all" },
    { label: "Active", value: "active" },
    { label: "Trialing", value: "trialing" },
    { label: "Past Due", value: "past_due" },
    { label: "Canceled", value: "canceled" },
    { label: "Incomplete", value: "incomplete" },
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
        {statusFilters.map((f) => (
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Salon</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Plan</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Amount</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Started</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Expires</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Phone</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <p className="text-sm font-semibold text-gray-900">{sub.salonName}</p>
                      <p className="text-xs text-gray-500">{sub.customerEmail}</p>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700">{sub.planName}</td>
                    <td className="px-5 py-3 text-sm font-semibold text-gray-900">
                      ${sub.amount.toFixed(2)}/{sub.interval}
                    </td>
                    <td className="px-5 py-3">
                      <SubscriptionStatusBadge status={sub.status} cancelAtEnd={sub.cancelAtPeriodEnd} />
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">
                      {new Date(sub.currentPeriodStart).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">
                      {new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">{sub.customerPhone}</td>
                  </tr>
                ))}
                {subscriptions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                      No subscriptions found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SubscriptionStatusBadge({ status, cancelAtEnd }: { status: string; cancelAtEnd: boolean }) {
  const styles: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    trialing: "bg-blue-50 text-blue-700 border-blue-200",
    past_due: "bg-orange-50 text-orange-700 border-orange-200",
    canceled: "bg-red-50 text-red-700 border-red-200",
    incomplete: "bg-yellow-50 text-yellow-700 border-yellow-200",
    incomplete_expired: "bg-gray-50 text-gray-600 border-gray-200",
    unpaid: "bg-red-50 text-red-700 border-red-200",
  };

  const label = cancelAtEnd && status === "active" ? "Canceling" : status.replace("_", " ");

  return (
    <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border capitalize ${styles[status] || styles.incomplete}`}>
      {label}
    </span>
  );
}
