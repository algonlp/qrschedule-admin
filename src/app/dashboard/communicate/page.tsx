"use client";

import { useEffect, useState } from "react";
import emailjs from "@emailjs/browser";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionCard } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SegmentedFilter } from "@/components/ui/DataTable";
import { FormField, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/Toast";

type Customer = { customerName: string; customerEmail: string; customerPhone: string };

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
  const toast = useToast();

  useEffect(() => {
    fetch("/api/stripe/subscriptions?status=all&limit=100")
      .then((res) => res.json())
      .then((data) => {
        if (data.data) {
          const seen = new Set<string>();
          setCustomers(
            data.data.filter((sub: Customer) => {
              if (seen.has(sub.customerEmail)) return false;
              seen.add(sub.customerEmail);
              return true;
            }),
          );
        }
      })
      .finally(() => setLoadingCustomers(false));
  }, []);

  function selectCustomer(email: string) {
    setSelectedCustomer(email);
    const cust = customers.find((c) => c.customerEmail === email);
    if (cust) {
      setToEmail(cust.customerEmail);
      setToPhone(cust.customerPhone !== "N/A" ? cust.customerPhone : "");
    }
  }

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const serviceId = process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID;
      const templateId = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID;
      const publicKey = process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY;
      if (!serviceId || !templateId || !publicKey) {
        toast.error("EmailJS is not configured. Add keys to .env.local");
        return;
      }
      await emailjs.send(serviceId, templateId, { to_email: toEmail, subject, message }, publicKey);
      toast.success(`Email sent to ${toEmail}`);
      setSubject("");
      setMessage("");
    } catch {
      toast.error("Failed to send email. Check EmailJS configuration.");
    } finally {
      setSending(false);
    }
  }

  async function sendSMS(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: toPhone, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to send SMS");
        return;
      }
      toast.success(`SMS sent to ${toPhone}`);
      setMessage("");
    } catch {
      toast.error("Failed to send SMS");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="Send Email / SMS" description="Send a one-off message to a subscriber." />

      <SegmentedFilter value={mode} onChange={setMode} options={[{ value: "email", label: "Email" }, { value: "sms", label: "SMS" }]} />

      <SectionCard title={mode === "email" ? "Send email" : "Send SMS"}>
        <form onSubmit={mode === "email" ? sendEmail : sendSMS} className="space-y-4">
          <FormField label="Select customer">
            {loadingCustomers ? (
              <div className="flex items-center gap-2 h-9 text-sm text-fg-subtle">
                <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Loading customers…
              </div>
            ) : (
              <Select value={selectedCustomer} onChange={(e) => selectCustomer(e.target.value)}>
                <option value="">— Select a customer —</option>
                {customers.map((c) => (
                  <option key={c.customerEmail} value={c.customerEmail}>
                    {c.customerName !== "N/A" ? `${c.customerName} (${c.customerEmail})` : c.customerEmail}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {mode === "email" ? (
            <>
              <FormField label="To email">
                <Input type="email" required value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="customer@example.com" />
              </FormField>
              <FormField label="Subject">
                <Input type="text" required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subscription update" />
              </FormField>
            </>
          ) : (
            <FormField label="To phone number" hint="E.164 format, e.g. +923001234567">
              <Input type="tel" required value={toPhone} onChange={(e) => setToPhone(e.target.value)} placeholder="+923001234567" />
            </FormField>
          )}

          <FormField label="Message">
            <Textarea
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={mode === "email" ? "Dear customer, your subscription…" : "Your QR Schedule subscription…"}
            />
          </FormField>

          <Button type="submit" loading={sending}>
            <Icon name="send" className="w-3.5 h-3.5" />
            {mode === "email" ? "Send email" : "Send SMS"}
          </Button>
        </form>
      </SectionCard>

      <Card className="p-4 border-warning/30 bg-warning-soft">
        <p className="text-sm font-medium text-warning">Setup required</p>
        <ul className="text-xs text-warning/90 mt-2 space-y-1 list-disc pl-4">
          <li><strong>Email:</strong> create an account at emailjs.com, set up a service + template, add the keys to .env.local</li>
          <li><strong>SMS:</strong> create a Twilio account, add Account SID, Auth Token and a phone number to .env.local</li>
        </ul>
      </Card>
    </div>
  );
}
