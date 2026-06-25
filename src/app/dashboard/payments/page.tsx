"use client";

import { useEffect, useState } from "react";

type Payment = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paid: boolean;
  refunded: boolean;
  salonName: string;
  customerName: string;
  customerEmail: string;
  description: string;
  created: string;
  receiptUrl: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  paymentMethod: string;
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/stripe/payments")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setPayments(data.data);
      })
      .catch(() => setError("Failed to load payments"))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p className="text-red-700 font-medium">{error}</p>
      </div>
    );
  }

  return (
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
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Description</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Amount</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Method</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Date</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr
                  key={payment.id}
                  className={`border-b border-gray-50 hover:bg-gray-50 ${payment.status === "failed" ? "bg-red-50/50" : ""}`}
                >
                  <td className="px-5 py-3">
                    <p className="text-sm font-semibold text-gray-900">{payment.salonName}</p>
                    <p className="text-xs text-gray-500">{payment.customerEmail}</p>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600 max-w-[200px] truncate">
                    {payment.description}
                  </td>
                  <td className="px-5 py-3 text-sm font-semibold text-gray-900">
                    ${payment.amount.toFixed(2)} {payment.currency.toUpperCase()}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600 capitalize">{payment.paymentMethod}</td>
                  <td className="px-5 py-3">
                    <PaymentStatusBadge status={payment.status} refunded={payment.refunded} />
                    {payment.failureMessage && (
                      <p className="text-xs text-red-600 mt-1 bg-red-50 px-2 py-1 rounded max-w-[200px]">
                        {payment.failureMessage}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">
                    {new Date(payment.created).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    {payment.receiptUrl ? (
                      <a
                        href={payment.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-gray-400 text-sm">-</span>
                    )}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                    No payments found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PaymentStatusBadge({ status, refunded }: { status: string; refunded: boolean }) {
  if (refunded) {
    return (
      <span className="inline-flex text-xs font-medium px-2.5 py-1 rounded-full border bg-gray-50 text-gray-600 border-gray-200">
        Refunded
      </span>
    );
  }

  const styles: Record<string, string> = {
    succeeded: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed: "bg-red-50 text-red-700 border-red-200",
    pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  };

  return (
    <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${styles[status] || styles.pending}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
