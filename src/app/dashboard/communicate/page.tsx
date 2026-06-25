"use client";

import { useEffect, useState } from "react";
import emailjs from "@emailjs/browser";

type Customer = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
};

export default function CommunicatePage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  const [mode, setMode] = useState<"email" | "sms">("email");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [toPhone, setToPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/stripe/subscriptions?status=all&limit=100")
      .then((res) => res.json())
      .then((data) => {
        if (data.data) {
          const seen = new Set<string>();
          const unique = data.data.filter((sub: Customer) => {
            if (seen.has(sub.customerEmail)) return false;
            seen.add(sub.customerEmail);
            return true;
          });
          setCustomers(unique);
        }
      })
      .finally(() => setLoadingCustomers(false));
  }, []);

  function handleCustomerSelect(email: string) {
    setSelectedCustomer(email);
    const cust = customers.find((c) => c.customerEmail === email);
    if (cust) {
      setToEmail(cust.customerEmail);
      setToPhone(cust.customerPhone !== "N/A" ? cust.customerPhone : "");
    }
  }

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setResult(null);

    try {
      const serviceId = process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID;
      const templateId = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID;
      const publicKey = process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY;

      if (!serviceId || !templateId || !publicKey) {
        setResult({ type: "error", text: "EmailJS is not configured. Add keys to .env.local" });
        return;
      }

      await emailjs.send(
        serviceId,
        templateId,
        {
          to_email: toEmail,
          subject: subject,
          message: message,
        },
        publicKey
      );

      setResult({ type: "success", text: `Email sent to ${toEmail}` });
      setSubject("");
      setMessage("");
    } catch {
      setResult({ type: "error", text: "Failed to send email. Check EmailJS configuration." });
    } finally {
      setSending(false);
    }
  }

  async function handleSendSMS(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setResult(null);

    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: toPhone, message }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({ type: "error", text: data.error || "Failed to send SMS" });
        return;
      }

      setResult({ type: "success", text: `SMS sent to ${toPhone}` });
      setMessage("");
    } catch {
      setResult({ type: "error", text: "Failed to send SMS" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex gap-2">
        <button
          onClick={() => setMode("email")}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            mode === "email" ? "bg-blue-600 text-white" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
          }`}
        >
          Send Email
        </button>
        <button
          onClick={() => setMode("sms")}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            mode === "sms" ? "bg-blue-600 text-white" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
          }`}
        >
          Send SMS
        </button>
      </div>

      {result && (
        <div
          className={`px-4 py-3 rounded-lg text-sm font-medium ${
            result.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {result.text}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">
          {mode === "email" ? "Send Email" : "Send SMS"}
        </h3>

        <form onSubmit={mode === "email" ? handleSendEmail : handleSendSMS} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Customer</label>
            {loadingCustomers ? (
              <p className="text-sm text-gray-400">Loading customers...</p>
            ) : (
              <select
                value={selectedCustomer}
                onChange={(e) => handleCustomerSelect(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="">-- Select a customer --</option>
                {customers.map((c) => (
                  <option key={c.customerEmail} value={c.customerEmail}>
                    {c.customerName !== "N/A" ? `${c.customerName} (${c.customerEmail})` : c.customerEmail}
                  </option>
                ))}
              </select>
            )}
          </div>

          {mode === "email" ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To Email</label>
                <input
                  type="email"
                  required
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="customer@example.com"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subscription Update"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Phone Number</label>
              <input
                type="tel"
                required
                value={toPhone}
                onChange={(e) => setToPhone(e.target.value)}
                placeholder="+923001234567"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                mode === "email"
                  ? "Dear customer, your subscription..."
                  : "Your QR Schedule subscription..."
              }
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={sending}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
            >
              {sending ? "Sending..." : mode === "email" ? "Send Email" : "Send SMS"}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h4 className="text-sm font-medium text-amber-800">Setup Required</h4>
        <ul className="text-xs text-amber-700 mt-2 space-y-1">
          <li>
            <strong>Email:</strong> Create an account at emailjs.com, set up a service and template, then add the keys to .env.local
          </li>
          <li>
            <strong>SMS:</strong> Create a Twilio account at twilio.com, get Account SID, Auth Token, and a phone number, then add to .env.local
          </li>
        </ul>
      </div>
    </div>
  );
}
