"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionCard } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, ErrorCard, Skeleton } from "@/components/ui/feedback";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/DataTable";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/Toast";
import { FormField, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/components/ui/utils";

type SourceLabel = "LIVE" | "MANUAL" | "STALE" | "UNKNOWN";
type Economics = {
  customerMinor: number;
  providerMinor: number | null;
  profitMinor: number | null;
  marginPct: number | null;
  markupPct: number | null;
  outcome: "profit" | "break_even" | "loss" | "unknown";
};
type ProviderRate = {
  id: string;
  provider: string;
  channel: string;
  country: string;
  category: string;
  currency: string;
  costPerMessageMinor: number;
  sourceType: string;
  sourceUrl: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  notes: string;
  fetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};
type SummaryRow = {
  category: string;
  customerMinor: number;
  economics: Economics;
  rate: { id: string; costPerMessageMinor: number; currency: string; effectiveFrom: string; sourceType: string; sourceUrl: string; notes: string } | null;
  sourceLabel: SourceLabel;
};
type ApiData = {
  rates: ProviderRate[];
  tableReady: boolean;
  summary: SummaryRow[];
  customerPricing: { whatsappCampaignMinor: number; transactionalMinor: number; updatedAt: string | null; currency: string };
  meta: { provider: string; channel: string; country: string; freshnessDays: number; liveSourceAvailable: boolean };
};

const money = (minor: number, currency = "PKR") =>
  `${currency} ${(minor / 100).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (minor: number | null, currency = "PKR") =>
  minor === null ? "—" : `${minor < 0 ? "-" : ""}${money(Math.abs(minor), currency)}`;
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}%`);
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const SOURCE_TONE: Record<SourceLabel, "success" | "primary" | "warning" | "neutral"> = {
  LIVE: "success",
  MANUAL: "primary",
  STALE: "warning",
  UNKNOWN: "neutral",
};

function ProfitValue({ e, currency, size = "sm" }: { e: Economics; currency: string; size?: "sm" | "lg" }) {
  if (e.outcome === "unknown") return <span className="text-fg-subtle">—</span>;
  const cls =
    e.outcome === "loss" ? "text-danger" : e.outcome === "break_even" ? "text-fg-muted" : "text-success";
  return (
    <span className={cn("font-semibold tabular-nums", cls, size === "lg" && "text-lg")}>
      {signedMoney(e.profitMinor, currency)}
    </span>
  );
}

export default function MessagingCostsPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ProviderRate | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [volumeInputs, setVolumeInputs] = useState<Record<string, string>>({});
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    fetch("/api/supabase/provider-messaging-costs")
      .then((r) => r.json())
      .then((d: ApiData & { error?: string }) => {
        if (d.error) setError(d.error);
        else {
          setError("");
          setData(d);
        }
      })
      .catch(() => setError("Failed to load messaging costs"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(async (body: Record<string, unknown>, method: "POST" | "PATCH") => {
    const res = await fetch("/api/supabase/provider-messaging-costs", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error((json.errors ?? [json.error]).join("; ") || "Request failed");
    return json;
  }, []);

  async function toggleStatus(rate: ProviderRate) {
    setBusyId(rate.id);
    try {
      await act({ id: rate.id, action: rate.status === "active" ? "deactivate" : "activate" }, "PATCH");
      toast.success(`Rate ${rate.status === "active" ? "deactivated" : "activated"}.`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  async function removeRate(rate: ProviderRate) {
    const yes = await confirm({
      title: "Delete this provider rate?",
      body: `The ${titleCase(rate.category)} rate effective ${rate.effectiveFrom} will be removed from history. This cannot be undone.`,
      confirmLabel: "Delete rate",
      tone: "danger",
    });
    if (!yes) return;
    setBusyId(rate.id);
    try {
      const res = await fetch(`/api/supabase/provider-messaging-costs?id=${encodeURIComponent(rate.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
      toast.success("Rate deleted.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  async function refresh() {
    const res = await fetch("/api/supabase/provider-messaging-costs/refresh", { method: "POST" });
    const json = await res.json();
    toast.toast(json.message || "Nothing to refresh.", "info");
  }

  const volumeRows = useMemo(() => {
    if (!data) return [];
    return data.summary.map((row) => {
      const count = Math.max(0, Math.floor(Number(volumeInputs[row.category] || 0)));
      const revenue = count * row.customerMinor;
      const cost = row.economics.providerMinor === null ? null : count * row.economics.providerMinor;
      return { category: row.category, count, revenue, cost, profit: cost === null ? null : revenue - cost };
    });
  }, [data, volumeInputs]);

  const volumeTotal = useMemo(() => {
    const known = volumeRows.filter((r) => r.cost !== null);
    const revenue = volumeRows.reduce((s, r) => s + r.revenue, 0);
    const cost = known.reduce((s, r) => s + (r.cost ?? 0), 0);
    return {
      revenue,
      cost: known.length > 0 ? cost : null,
      profit: known.length > 0 ? revenue - cost : null,
      anyUnknown: volumeRows.some((r) => r.count > 0 && r.cost === null),
    };
  }, [volumeRows]);

  if (loading) return <PageShell><div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div></PageShell>;
  if (error || !data) return <PageShell><ErrorCard message={error} onRetry={() => { setLoading(true); load(); }} /></PageShell>;

  const currency = data.customerPricing.currency;
  const primary = data.summary.find((s) => s.category === "marketing") ?? data.summary[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Messaging Costs"
        description="Compare what QR Schedule pays a provider against what it charges the salon. Provider costs are entered manually from Meta's official pricing — never fabricated. Analytics only: this never changes customer pricing, wallets, or sending."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={refresh}>
              <Icon name="refresh" className="w-3.5 h-3.5" />
              Refresh rate
            </Button>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Icon name="plus" className="w-3.5 h-3.5" />
              Add rate
            </Button>
          </>
        }
      />

      {!data.tableReady && (
        <Card className="p-4 border-warning/30 bg-warning-soft">
          <p className="text-sm text-warning">
            The <code className="font-mono text-xs">provider_messaging_costs</code> table doesn&rsquo;t exist yet. Run{" "}
            <code className="font-mono text-xs">supabase/provider-messaging-costs.sql</code>, then reload. Customer prices and the
            calculator below still work — provider cost just shows as Unknown.
          </p>
        </Card>
      )}

      {/* Headline economics */}
      <Card className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h3 className="text-sm font-semibold text-fg">
            WhatsApp economics — {titleCase(primary.category)} · {data.meta.country}
          </h3>
          <Badge tone={SOURCE_TONE[primary.sourceLabel]} dot>
            {primary.sourceLabel}
          </Badge>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <HeadStat label="Customer price" value={money(primary.customerMinor, currency)} sub="/ message" />
          <HeadStat
            label="Provider (Meta) cost"
            value={primary.economics.providerMinor === null ? "Unknown" : money(primary.economics.providerMinor, currency)}
            sub={primary.rate ? `effective ${primary.rate.effectiveFrom}` : "not configured"}
            muted={primary.economics.providerMinor === null}
          />
          <HeadStat
            label={primary.economics.outcome === "loss" ? "Gross loss" : "Gross profit"}
            valueNode={<ProfitValue e={primary.economics} currency={currency} size="lg" />}
            sub="/ message"
          />
          <HeadStat
            label="Margin"
            value={pct(primary.economics.marginPct)}
            sub={primary.economics.markupPct === null ? "" : `markup ${pct(primary.economics.markupPct)}`}
            danger={primary.economics.marginPct !== null && primary.economics.marginPct < 0}
          />
        </div>
        {primary.economics.outcome === "unknown" && (
          <p className="text-xs text-fg-subtle mt-3">
            No verified provider cost is configured for {primary.category}. Profit and margin show &ldquo;—&rdquo; — they are{" "}
            <span className="font-medium text-fg-muted">not</span> assumed to be zero.
          </p>
        )}
      </Card>

      {/* Per-category */}
      <SectionCard
        title="Profit by category"
        description="Customer price comes from Messaging Pricing. Utility & authentication share the transactional rate."
        bodyClassName="p-0"
      >
        <Table>
          <THead>
            <TH>Category</TH>
            <TH align="right">Customer</TH>
            <TH align="right">Provider cost</TH>
            <TH align="right">Profit / msg</TH>
            <TH align="right">Margin</TH>
            <TH>Source</TH>
          </THead>
          <TBody>
            {data.summary.map((row) => (
              <TR key={row.category}>
                <TD className="font-medium text-fg">{titleCase(row.category)}</TD>
                <TD align="right" className="text-fg">{money(row.customerMinor, currency)}</TD>
                <TD align="right">
                  {row.economics.providerMinor === null ? (
                    <span className="text-fg-subtle">Unknown</span>
                  ) : (
                    <span className="text-fg">{money(row.economics.providerMinor, currency)}</span>
                  )}
                </TD>
                <TD align="right"><ProfitValue e={row.economics} currency={currency} /></TD>
                <TD align="right">
                  <span className={row.economics.marginPct !== null && row.economics.marginPct < 0 ? "text-danger" : "text-fg"}>
                    {pct(row.economics.marginPct)}
                  </span>
                </TD>
                <TD><Badge tone={SOURCE_TONE[row.sourceLabel]}>{row.sourceLabel}</Badge></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </SectionCard>

      {/* Volume estimator */}
      <SectionCard title="Estimated profit at volume" description="Enter a monthly message count per category. Estimate only — not actual Meta billing.">
        <Table>
          <THead>
            <TH>Category</TH>
            <TH align="right">Messages</TH>
            <TH align="right">Revenue</TH>
            <TH align="right">Provider cost</TH>
            <TH align="right">Gross profit</TH>
          </THead>
          <TBody>
            {volumeRows.map((r) => (
              <TR key={r.category}>
                <TD className="font-medium text-fg">{titleCase(r.category)}</TD>
                <TD align="right">
                  <input
                    type="number"
                    min={0}
                    value={volumeInputs[r.category] ?? ""}
                    onChange={(e) => setVolumeInputs((v) => ({ ...v, [r.category]: e.target.value }))}
                    placeholder="0"
                    className="w-28 h-8 px-2 text-sm text-right tabular-nums rounded-lg bg-surface border border-border-strong text-fg focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                  />
                </TD>
                <TD align="right" className="text-fg">{money(r.revenue, currency)}</TD>
                <TD align="right">{r.cost === null ? <span className="text-fg-subtle">Unknown</span> : <span className="text-fg">{money(r.cost, currency)}</span>}</TD>
                <TD align="right">
                  {r.profit === null ? (
                    <span className="text-fg-subtle">—</span>
                  ) : (
                    <span className={cn("font-semibold", r.profit < 0 ? "text-danger" : "text-success")}>{signedMoney(r.profit, currency)}</span>
                  )}
                </TD>
              </TR>
            ))}
            <tr className="border-t-2 border-border-strong font-semibold text-fg">
              <td className="px-4 py-3">Total</td>
              <td className="px-4 py-3 text-right tabular-nums">{volumeRows.reduce((s, r) => s + r.count, 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(volumeTotal.revenue, currency)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{volumeTotal.cost === null ? "—" : money(volumeTotal.cost, currency)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{volumeTotal.profit === null ? "—" : signedMoney(volumeTotal.profit, currency)}</td>
            </tr>
          </TBody>
        </Table>
        {volumeTotal.anyUnknown && (
          <p className="text-xs text-warning mt-3 px-1">
            Some categories have no configured provider cost — their cost and profit are excluded from the total.
          </p>
        )}
      </SectionCard>

      {/* Rate history */}
      <SectionCard
        title="Configured provider rates"
        description={`Verified rate history. The one effective today drives the numbers above. Rates older than ${data.meta.freshnessDays} days show as STALE.`}
        action={<Button size="sm" variant="secondary" onClick={() => setEditing("new")}><Icon name="plus" className="w-3.5 h-3.5" />Add rate</Button>}
        bodyClassName="p-0"
      >
        {data.rates.length === 0 ? (
          <EmptyState
            icon="cost"
            title="No provider rates configured"
            description="Add your first verified provider rate from Meta's official pricing page to calculate messaging economics."
            action={<Button size="sm" onClick={() => setEditing("new")}><Icon name="plus" className="w-3.5 h-3.5" />Add provider rate</Button>}
          />
        ) : (
          <Table>
            <THead>
              <TH>Provider / Channel</TH>
              <TH>Country</TH>
              <TH>Category</TH>
              <TH align="right">Cost / msg</TH>
              <TH>Effective</TH>
              <TH>Source</TH>
              <TH>Status</TH>
              <TH align="right" />
            </THead>
            <TBody>
              {data.rates.map((rate) => (
                <TR key={rate.id} className={rate.status !== "active" ? "opacity-60" : ""}>
                  <TD className="text-fg">{titleCase(rate.provider)} / {titleCase(rate.channel)}</TD>
                  <TD>{rate.country}</TD>
                  <TD>{titleCase(rate.category)}</TD>
                  <TD align="right" className="text-fg font-medium">{money(rate.costPerMessageMinor, rate.currency)}</TD>
                  <TD className="text-fg-subtle whitespace-nowrap">{rate.effectiveFrom}{rate.effectiveTo ? ` → ${rate.effectiveTo}` : ""}</TD>
                  <TD>
                    <span className="uppercase text-xs text-fg-subtle">{rate.sourceType}</span>
                    {rate.sourceUrl && (
                      <a href={rate.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs ml-1.5 inline-flex items-center gap-0.5">
                        link<Icon name="external" className="w-3 h-3" />
                      </a>
                    )}
                  </TD>
                  <TD><Badge tone={rate.status === "active" ? "success" : "neutral"}>{rate.status}</Badge></TD>
                  <TD align="right">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => setEditing(rate)} disabled={busyId === rate.id} className="text-xs font-medium text-primary hover:underline cursor-pointer disabled:opacity-50 px-1">Edit</button>
                      <button onClick={() => toggleStatus(rate)} disabled={busyId === rate.id} className="text-xs font-medium text-fg-muted hover:text-fg cursor-pointer disabled:opacity-50 px-1">
                        {rate.status === "active" ? "Deactivate" : "Activate"}
                      </button>
                      <button onClick={() => removeRate(rate)} disabled={busyId === rate.id} className="text-xs font-medium text-danger hover:underline cursor-pointer disabled:opacity-50 px-1">Delete</button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </SectionCard>

      {editing && (
        <RateModal
          rate={editing === "new" ? null : editing}
          defaultCountry={data.meta.country}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); toast.success(msg); load(); }}
          save={act}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHeader title="Messaging Costs" description="Provider cost vs customer price, per category." />
      {children}
    </div>
  );
}

function HeadStat({ label, value, valueNode, sub, muted, danger }: { label: string; value?: string; valueNode?: React.ReactNode; sub?: string; muted?: boolean; danger?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p className={cn("text-lg font-bold mt-1 tabular-nums tracking-tight", danger ? "text-danger" : muted ? "text-fg-subtle" : "text-fg")}>
        {valueNode ?? value}
      </p>
      {sub && <p className="text-[11px] text-fg-subtle mt-0.5">{sub}</p>}
    </div>
  );
}

function RateModal({
  rate,
  defaultCountry,
  onClose,
  onSaved,
  save,
}: {
  rate: ProviderRate | null;
  defaultCountry: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
  save: (body: Record<string, unknown>, method: "POST" | "PATCH") => Promise<unknown>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    provider: rate?.provider ?? "meta",
    channel: rate?.channel ?? "whatsapp",
    country: rate?.country ?? defaultCountry,
    category: rate?.category ?? "marketing",
    currency: rate?.currency ?? "PKR",
    rupees: rate ? (rate.costPerMessageMinor / 100).toString() : "",
    sourceType: rate?.sourceType ?? "manual",
    sourceUrl: rate?.sourceUrl ?? "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing",
    effectiveFrom: rate?.effectiveFrom ?? today,
    effectiveTo: rate?.effectiveTo ?? "",
    notes: rate?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setSaving(true);
    setErrs([]);
    const minor = Math.round(Number(form.rupees) * 100);
    const body: Record<string, unknown> = {
      provider: form.provider, channel: form.channel, country: form.country, category: form.category,
      currency: form.currency, costPerMessageMinor: Number.isFinite(minor) ? minor : NaN,
      sourceType: form.sourceType, sourceUrl: form.sourceUrl, effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo, notes: form.notes,
    };
    try {
      if (rate) await save({ ...body, id: rate.id }, "PATCH");
      else await save(body, "POST");
      onSaved(rate ? "Rate updated." : "Rate added.");
    } catch (e) {
      setErrs(e instanceof Error ? e.message.split("; ") : ["Save failed"]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={rate ? "Edit provider rate" : "Add provider rate"}
      description="Enter the rate exactly as published on Meta's official pricing page for this country and category."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={saving} onClick={submit}>{rate ? "Save changes" : "Add rate"}</Button>
        </>
      }
    >
      {errs.length > 0 && (
        <div className="bg-danger-soft border border-danger/30 rounded-lg p-3 text-sm text-danger mb-4 space-y-1">
          {errs.map((e, i) => <p key={i}>• {e}</p>)}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Provider">
          <Select value={form.provider} onChange={(e) => set("provider", e.target.value)}>
            <option value="meta">Meta</option><option value="twilio">Twilio</option><option value="email">Email</option>
          </Select>
        </FormField>
        <FormField label="Channel">
          <Select value={form.channel} onChange={(e) => set("channel", e.target.value)}>
            <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option>
          </Select>
        </FormField>
        <FormField label="Country (ISO-2)">
          <Input value={form.country} maxLength={2} onChange={(e) => set("country", e.target.value.toUpperCase())} />
        </FormField>
        <FormField label="Category">
          <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
            <option value="marketing">Marketing</option><option value="utility">Utility</option>
            <option value="authentication">Authentication</option><option value="service">Service</option>
          </Select>
        </FormField>
        <FormField label="Currency (ISO-3)">
          <Input value={form.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
        </FormField>
        <FormField label={`Cost per message (${form.currency})`}>
          <Input type="number" min={0} step="0.0001" value={form.rupees} onChange={(e) => set("rupees", e.target.value)} />
        </FormField>
        <FormField label="Source type">
          <Select value={form.sourceType} onChange={(e) => set("sourceType", e.target.value)}>
            <option value="manual">Manual</option><option value="live">Live</option>
          </Select>
        </FormField>
        <FormField label="Effective from">
          <Input type="date" value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />
        </FormField>
        <FormField label="Effective to (optional)" className="col-span-2">
          <Input type="date" value={form.effectiveTo} onChange={(e) => set("effectiveTo", e.target.value)} />
        </FormField>
        <FormField label="Source URL" className="col-span-2">
          <Input value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} />
        </FormField>
        <FormField label="Notes" className="col-span-2">
          <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}
