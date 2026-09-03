"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CHANNELS,
  RATE_KEYS,
  type Channel,
  type EffectiveMessagingPricing,
  type RateKey,
  type ResolvedChannel,
  type ResolvedRate,
} from "@/lib/messaging-pricing";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionCard } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Toggle } from "@/components/ui/form";
import { CenteredSpinner, ErrorCard } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/components/ui/utils";

const money = (cents: number) => `PKR ${(cents / 100).toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

const CHANNEL_ICON: Record<Channel, IconName> = { sms: "chat", whatsapp: "whatsapp", email: "mail" };

type Draft = {
  rates: Record<RateKey, { enabled: boolean; rupees: string }>;
  channels: Record<Channel, boolean>;
};

function draftFrom(p: EffectiveMessagingPricing): Draft {
  const rates = {} as Draft["rates"];
  for (const r of p.rates) rates[r.key] = { enabled: r.enabled, rupees: (r.effectiveCents / 100).toString() };
  const channels = {} as Draft["channels"];
  for (const c of p.channels) channels[c.key] = c.enabled;
  return { rates, channels };
}

export default function MessagingPricingPage() {
  const [pricing, setPricing] = useState<EffectiveMessagingPricing | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    fetch("/api/supabase/messaging-pricing")
      .then((r) => r.json())
      .then((d: { data?: EffectiveMessagingPricing; error?: string }) => {
        if (d.error || !d.data) { setError(d.error || "Failed to load"); return; }
        setError("");
        setPricing(d.data);
        setDraft(draftFrom(d.data));
      })
      .catch(() => setError("Failed to load messaging pricing"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <Shell><ErrorCard message={error} onRetry={() => { setLoading(true); load(); }} /></Shell>;
  if (loading || !pricing || !draft) return <Shell><Card><CenteredSpinner /></Card></Shell>;

  const centsFor = (key: RateKey) => Math.round(Number(draft.rates[key].rupees || 0) * 100);
  const pendingRateEffective = (r: ResolvedRate) => (draft.rates[r.key].enabled ? centsFor(r.key) : r.defaultCents);
  const channelEnabledNow = (c: ResolvedChannel) => (c.configured ? draft.channels[c.key] : false);

  const rateChanged = (r: ResolvedRate) => {
    const d = draft.rates[r.key];
    if (d.enabled !== r.enabled) return true;
    if (d.enabled && centsFor(r.key) !== (r.storedCents ?? r.effectiveCents)) return true;
    return false;
  };
  const channelChanged = (c: ResolvedChannel) => c.configured && draft.channels[c.key] !== c.enabled;

  const changeCount =
    pricing.rates.filter(rateChanged).length + pricing.channels.filter(channelChanged).length;
  const dirty = changeCount > 0;

  async function save() {
    setSaving(true);
    setFormErrors([]);
    try {
      const res = await fetch("/api/supabase/messaging-pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rates: Object.fromEntries(RATE_KEYS.map((k) => [k, { enabled: draft!.rates[k].enabled, cents: centsFor(k) }])),
          channels: Object.fromEntries(CHANNELS.map((k) => [k, { enabled: draft!.channels[k] }])),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setFormErrors(data.errors ?? [data.error ?? "Save failed"]); return; }
      setConfirming(false);
      toast.success(data.changed ? `Saved. Live on qrschedule.com now.` : "Saved — nothing changed.");
      load();
    } catch {
      setFormErrors(["Network error while saving"]);
    } finally {
      setSaving(false);
    }
  }

  const campaignRates = pricing.rates.filter((r) => r.kind === "campaign");
  const txRates = pricing.rates.filter((r) => r.kind === "transactional");

  return (
    <Shell>
      {formErrors.length > 0 && (
        <div className="bg-danger-soft border border-danger/30 rounded-lg p-3 text-sm text-danger space-y-1">
          {formErrors.map((e, i) => <p key={i}>• {e}</p>)}
        </div>
      )}

      {/* At a glance — what qrschedule.com charges right now */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Live on qrschedule.com right now</h3>
          {pricing.updatedAt && (
            <span className="text-xs text-fg-subtle">
              Updated {new Date(pricing.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {pricing.updatedBy ? ` · ${pricing.updatedBy}` : ""}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {pricing.rates.map((r) => {
            const chOff = pricing.channels.some((c) => c.key === r.key && !c.enabled);
            return (
              <div key={r.key} className="rounded-lg bg-surface-2 px-3 py-2.5">
                <p className="text-[11px] font-medium text-fg-muted truncate">{r.label}</p>
                <p className={cn("text-base font-bold tabular-nums mt-0.5", chOff ? "text-fg-subtle line-through" : "text-fg")}>
                  {money(r.effectiveCents)}
                </p>
                <p className="text-[10px] text-fg-subtle mt-0.5">{r.enabled ? "Custom" : "System default"}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Channels */}
      <SectionCard
        title="Delivery channels"
        description="Turn a channel off to stop ALL customer messages on it — campaigns and booking notifications. Internal admin emails keep working."
        bodyClassName="p-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {pricing.channels.map((c) => {
            const on = channelEnabledNow(c);
            const changed = channelChanged(c);
            return (
              <div
                key={c.key}
                className={cn(
                  "rounded-xl border p-3.5 transition-colors",
                  changed ? "border-primary/50 bg-primary-soft/40" : "border-border bg-surface",
                  !c.configured && "opacity-70",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-8 h-8 rounded-lg",
                      on ? "bg-success-soft text-success" : "bg-surface-2 text-fg-subtle",
                    )}
                  >
                    <Icon name={CHANNEL_ICON[c.key]} className="w-4 h-4" />
                  </span>
                  <Toggle
                    checked={on}
                    disabled={!c.configured}
                    label={`${c.label} channel`}
                    onChange={(next) => setDraft({ ...draft, channels: { ...draft.channels, [c.key]: next } })}
                  />
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-fg">{c.label}</h4>
                  {!c.configured ? (
                    <Badge tone="neutral">No provider</Badge>
                  ) : on ? (
                    <Badge tone="success" dot>On</Badge>
                  ) : (
                    <Badge tone="danger" dot>Off</Badge>
                  )}
                </div>
                <p className="text-xs text-fg-subtle mt-1 leading-relaxed">
                  {c.configured
                    ? `Currently ${c.enabled ? "delivering" : "blocked"}${c.override === false ? " — turned off by an admin" : ""}.`
                    : `Cannot be enabled until its provider is configured on qrschedule.com.`}
                </p>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Campaign rates */}
      <SectionCard
        title="Campaign message rates"
        description="Charged from the salon's wallet for every message sent in a marketing campaign."
        bodyClassName="p-0"
      >
        <div className="divide-y divide-border">
          {campaignRates.map((r) => (
            <RateRow
              key={r.key}
              rate={r}
              draft={draft.rates[r.key]}
              changed={rateChanged(r)}
              channelOff={pricing.channels.some((c) => c.key === r.key && !channelEnabledNow(c))}
              onChange={(patch) => setDraft({ ...draft, rates: { ...draft.rates, [r.key]: { ...draft.rates[r.key], ...patch } } })}
            />
          ))}
        </div>
      </SectionCard>

      {/* Transactional rate */}
      <SectionCard
        title="Transactional message rate"
        description="Per booking confirmation / reminder once a plan's allowance is used up, and for extra credits."
        bodyClassName="p-0"
      >
        <div className="divide-y divide-border">
          {txRates.map((r) => (
            <RateRow
              key={r.key}
              rate={r}
              draft={draft.rates[r.key]}
              changed={rateChanged(r)}
              channelOff={false}
              onChange={(patch) => setDraft({ ...draft, rates: { ...draft.rates, [r.key]: { ...draft.rates[r.key], ...patch } } })}
            />
          ))}
        </div>
      </SectionCard>

      {/* Sticky action bar */}
      <div className="sticky bottom-4 z-10">
        <Card className={cn("flex items-center justify-between gap-3 px-4 py-3 shadow-md", dirty && "border-primary/40")}>
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span
              className={cn(
                "inline-flex w-2 h-2 rounded-full shrink-0",
                dirty ? "bg-primary" : "bg-success",
              )}
            />
            <span className="text-fg-muted truncate">
              {dirty
                ? `${changeCount} unsaved change${changeCount === 1 ? "" : "s"}`
                : "Everything published"}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {dirty && (
              <button
                onClick={() => setDraft(draftFrom(pricing))}
                className="text-sm font-medium text-fg-muted hover:text-fg cursor-pointer px-2"
              >
                Reset
              </button>
            )}
            <Button size="sm" disabled={saving || !dirty} onClick={() => setConfirming(true)}>
              Review &amp; publish
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Publish messaging changes"
        description="Applies from the moment you publish. Past transactions are not affected."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button size="sm" loading={saving} onClick={save}>Publish</Button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-fg-subtle uppercase border-b border-border">
                <th className="text-left py-1.5">Item</th>
                <th className="text-right py-1.5">Before</th>
                <th className="text-right py-1.5">After</th>
              </tr>
            </thead>
            <tbody className="text-fg-muted divide-y divide-border">
              {pricing.channels.map((c) => {
                const after = channelEnabledNow(c);
                const changed = c.configured && after !== c.enabled;
                return (
                  <tr key={`ch-${c.key}`}>
                    <td className="py-1.5">{c.label} channel</td>
                    <td className="text-right">{c.enabled ? "On" : "Off"}</td>
                    <td className={cn("text-right font-semibold", changed ? "text-primary" : "text-fg")}>{after ? "On" : "Off"}</td>
                  </tr>
                );
              })}
              {pricing.rates.map((r) => {
                const afterCents = pendingRateEffective(r);
                const changed = afterCents !== r.effectiveCents || draft.rates[r.key].enabled !== r.enabled;
                return (
                  <tr key={`rt-${r.key}`}>
                    <td className="py-1.5">{r.label} rate</td>
                    <td className="text-right tabular-nums">{money(r.effectiveCents)}</td>
                    <td className={cn("text-right tabular-nums font-semibold", changed ? "text-primary" : "text-fg")}>{money(afterCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl space-y-5 pb-4">
      <PageHeader
        title="Messaging Pricing"
        description="Control what QR Schedule charges per message and switch whole channels on or off. Publishing goes live on qrschedule.com immediately. Past wallet transactions are never re-priced."
      />
      {children}
    </div>
  );
}

function RateRow({
  rate,
  draft,
  changed,
  channelOff,
  onChange,
}: {
  rate: ResolvedRate;
  draft: { enabled: boolean; rupees: string };
  changed: boolean;
  channelOff: boolean;
  onChange: (patch: Partial<{ enabled: boolean; rupees: string }>) => void;
}) {
  return (
    <div className={cn("p-4 transition-colors", channelOff && "opacity-60", changed && "bg-primary-soft/40")}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-fg">{rate.label}</h4>
            <Badge tone={draft.enabled ? "primary" : "neutral"}>{draft.enabled ? "Custom rate" : "System default"}</Badge>
            {changed && <Badge tone="warning">Edited</Badge>}
          </div>
          <p className="text-xs text-fg-subtle mt-1 leading-relaxed">{rate.desc}</p>
          <p className="text-xs text-fg-subtle mt-1.5">
            {channelOff ? (
              <span className="text-danger">This channel is off — no messages are being sent or charged.</span>
            ) : (
              <>
                Charging now:{" "}
                <span className="font-semibold text-fg-muted tabular-nums">{money(rate.effectiveCents)}</span>
                {!rate.enabled && " (system default)"}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2.5">
          <label className="flex items-center gap-2 text-xs font-medium text-fg-muted cursor-pointer select-none">
            Custom rate
            <Toggle
              size="sm"
              checked={draft.enabled}
              label={`Use a custom ${rate.label} rate`}
              onChange={(next) => onChange({ enabled: next })}
            />
          </label>
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 h-9 transition-colors",
              draft.enabled ? "border-border-strong bg-surface" : "border-border bg-surface-2",
            )}
          >
            <span className="text-xs text-fg-subtle">PKR</span>
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              disabled={!draft.enabled}
              value={draft.enabled ? draft.rupees : (rate.defaultCents / 100).toString()}
              onChange={(e) => onChange({ rupees: e.target.value })}
              className="w-20 bg-transparent text-sm text-right tabular-nums text-fg focus:outline-none disabled:text-fg-subtle"
            />
            <span className="text-xs text-fg-subtle">/ msg</span>
          </div>
        </div>
      </div>
    </div>
  );
}
