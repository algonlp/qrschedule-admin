"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ENTITLEMENTS,
  ENTITLEMENT_FIELDS,
  ENTITLEMENT_MONEY_FIELDS,
  PLAN_FEATURE_CATALOG,
  validatePlan,
  type BillingInterval,
  type SubscriptionPlan,
  type SubscriptionPlanEntitlements,
} from "@/lib/plans";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { CenteredSpinner, EmptyState, ErrorCard } from "@/components/ui/feedback";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/Toast";
import { FormField, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/components/ui/utils";

type PackagesResponse = {
  data: SubscriptionPlan[];
  subscriberCounts: Record<string, number>;
  featureCatalog: { key: string; label: string; requiredPlanKey?: string }[];
};
type ImpactPrompt = { activeSubscribers: number; changes: string[] };

const MONEY_ENT = new Set<string>(ENTITLEMENT_MONEY_FIELDS as string[]);

function formatMoney(amountCents: number, currencyCode: string) {
  const amount = (Number(amountCents) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "PKR",
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString()}`;
  }
}

function blankPlan(): SubscriptionPlan {
  const now = new Date().toISOString();
  return {
    id: "", key: "", name: "", summary: "", amountCents: 0, currencyCode: "PKR",
    billingInterval: "month", trialDays: 30, badgeLabel: "", isActive: true, displayOrder: 0,
    entitlements: { ...DEFAULT_ENTITLEMENTS, featureKeys: [...DEFAULT_ENTITLEMENTS.featureKeys] },
    createdAt: now, updatedAt: now,
  };
}

export default function PackagesPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [isCreate, setIsCreate] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [impactPrompt, setImpactPrompt] = useState<ImpactPrompt | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    fetch("/api/supabase/packages")
      .then((res) => res.json())
      .then((data: PackagesResponse & { error?: string }) => {
        if (data.error) { setError(data.error); return; }
        setError("");
        setPlans([...data.data].sort((a, b) => a.displayOrder - b.displayOrder));
        setCounts(data.subscriberCounts || {});
      })
      .catch(() => setError("Failed to load packages"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const existing = useMemo(() => plans.map((p) => ({ id: p.id, key: p.key })), [plans]);

  function startCreate() {
    const next = blankPlan();
    next.displayOrder = (plans.reduce((max, p) => Math.max(max, p.displayOrder), 0) || 0) + 10;
    setEditing(next); setIsCreate(true); setFormErrors([]); setImpactPrompt(null);
  }
  function startEdit(plan: SubscriptionPlan) {
    setEditing(JSON.parse(JSON.stringify(plan))); setIsCreate(false); setFormErrors([]); setImpactPrompt(null);
  }
  function startDuplicate(plan: SubscriptionPlan) {
    const copy: SubscriptionPlan = JSON.parse(JSON.stringify(plan));
    copy.id = `${plan.id}_copy`; copy.key = `${plan.key}_copy`; copy.name = `${plan.name} (copy)`;
    copy.isActive = false; copy.displayOrder = plan.displayOrder + 1; copy.createdAt = new Date().toISOString();
    setEditing(copy); setIsCreate(true); setFormErrors([]); setImpactPrompt(null);
  }
  async function toggleActive(plan: SubscriptionPlan) {
    await save({ ...plan, isActive: !plan.isActive }, false, { silentToggle: true });
  }

  async function save(plan: SubscriptionPlan, acknowledgeSubscriberImpact: boolean, opts: { silentToggle?: boolean } = {}) {
    const isCreateOp = isCreate && !opts.silentToggle;
    const check = validatePlan(plan, { isCreate: isCreateOp, existing, currentId: isCreateOp ? undefined : plan.id });
    if (!check.ok) { setFormErrors(check.errors); return; }

    setSaving(true); setFormErrors([]);
    try {
      const res = await fetch("/api/supabase/packages", {
        method: isCreateOp ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isCreateOp ? { plan: check.plan } : { id: plan.id, plan: check.plan, acknowledgeSubscriberImpact }),
      });
      const data = await res.json();
      if (res.status === 409 && data.requiresAcknowledgement) {
        setImpactPrompt({ activeSubscribers: data.activeSubscribers ?? 0, changes: data.changes ?? [] });
        setSaving(false);
        return;
      }
      if (!res.ok) { setFormErrors(data.errors ?? [data.error ?? "Save failed"]); setSaving(false); return; }

      toast.success(
        opts.silentToggle
          ? `"${plan.name}" ${plan.isActive ? "activated" : "deactivated"}.`
          : `"${check.plan.name}" saved. Live on qrschedule.com now.`,
      );
      setEditing(null); setImpactPrompt(null); load();
    } catch {
      setFormErrors(["Network error while saving"]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Packages"
        description="The single source of truth for subscription plans. Saving publishes to qrschedule.com immediately — pricing page, checkout and entitlement checks all read these values."
        actions={
          <Button size="sm" onClick={startCreate}>
            <Icon name="plus" className="w-3.5 h-3.5" />
            New package
          </Button>
        }
      />

      {error ? (
        <ErrorCard message={error} onRetry={() => { setLoading(true); load(); }} />
      ) : loading ? (
        <Card><CenteredSpinner /></Card>
      ) : plans.length === 0 ? (
        <Card>
          <EmptyState icon="packages" title="No packages yet" description="Create your first subscription package." action={<Button size="sm" onClick={startCreate}>New package</Button>} />
        </Card>
      ) : (
        <>
          {/* Plan cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const feats = PLAN_FEATURE_CATALOG.filter((f) => plan.entitlements.featureKeys.includes(f.key)).slice(0, 5);
              return (
                <Card key={plan.id} className="p-5 flex flex-col" interactive>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-fg">{plan.name}</p>
                      <p className="text-xs text-fg-subtle font-mono">{plan.key}</p>
                    </div>
                    <Badge tone={plan.isActive ? "success" : "neutral"}>{plan.isActive ? "Active" : "Inactive"}</Badge>
                  </div>
                  <p className="text-2xl font-bold text-fg mt-3 tracking-tight tabular-nums">
                    {formatMoney(plan.amountCents, plan.currencyCode)}
                    <span className="text-sm font-normal text-fg-subtle"> / {plan.billingInterval}</span>
                  </p>
                  <p className="text-xs text-fg-muted mt-1">
                    {plan.trialDays > 0 ? `${plan.trialDays}-day trial` : "No trial"}
                    {plan.badgeLabel ? ` · ${plan.badgeLabel}` : ""}
                    {counts[plan.id] ? ` · ${counts[plan.id]} active` : ""}
                  </p>
                  <div className="mt-3 space-y-1 flex-1">
                    {feats.map((f) => (
                      <p key={f.key} className="text-xs text-fg-muted flex items-center gap-1.5">
                        <Icon name="check" className="w-3.5 h-3.5 text-success shrink-0" />
                        {f.label}
                      </p>
                    ))}
                    {plan.entitlements.featureKeys.length > 5 && (
                      <p className="text-xs text-fg-subtle pl-5">+{plan.entitlements.featureKeys.length - 5} more</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-border">
                    <Button size="sm" variant="secondary" onClick={() => startEdit(plan)}>Edit plan</Button>
                    <button onClick={() => startDuplicate(plan)} className="text-xs font-medium text-fg-muted hover:text-fg cursor-pointer px-2">Duplicate</button>
                    <button
                      onClick={() => toggleActive(plan)}
                      className={cn("text-xs font-medium cursor-pointer px-2 ml-auto", plan.isActive ? "text-warning hover:brightness-110" : "text-success hover:brightness-110")}
                    >
                      {plan.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Compact table */}
          <Card className="overflow-hidden">
            <Table>
              <THead>
                <TH>Order</TH><TH>Package</TH><TH>Key</TH><TH align="right">Price</TH><TH align="right">Active subs</TH><TH>Status</TH><TH align="right" />
              </THead>
              <TBody>
                {plans.map((plan) => (
                  <TR key={plan.id}>
                    <TD className="tabular-nums">{plan.displayOrder}</TD>
                    <TD>
                      <p className="text-sm font-medium text-fg">{plan.name}</p>
                      <p className="text-xs text-fg-subtle max-w-xs truncate">{plan.summary}</p>
                    </TD>
                    <TD className="font-mono text-xs">{plan.key}</TD>
                    <TD align="right" className="text-fg whitespace-nowrap">
                      {formatMoney(plan.amountCents, plan.currencyCode)}<span className="text-fg-subtle">/{plan.billingInterval}</span>
                    </TD>
                    <TD align="right">
                      {counts[plan.id] ? <span className="text-warning font-semibold">{counts[plan.id]}</span> : <span className="text-fg-subtle">0</span>}
                    </TD>
                    <TD><Badge tone={plan.isActive ? "success" : "neutral"}>{plan.isActive ? "Active" : "Inactive"}</Badge></TD>
                    <TD align="right">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => startEdit(plan)} className="text-xs font-medium text-primary hover:underline cursor-pointer">Edit</button>
                        <button onClick={() => startDuplicate(plan)} className="text-xs font-medium text-fg-muted hover:text-fg cursor-pointer">Duplicate</button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      )}

      {editing && (
        <PackageEditor
          plan={editing}
          isCreate={isCreate}
          saving={saving}
          errors={formErrors}
          impactPrompt={impactPrompt}
          activeSubscribers={counts[editing.id] ?? 0}
          featureCatalog={PLAN_FEATURE_CATALOG}
          onChange={setEditing}
          onCancel={() => { setEditing(null); setIsCreate(false); setImpactPrompt(null); }}
          onSave={(ack) => save(editing, ack)}
        />
      )}
    </div>
  );
}

function PackageEditor({
  plan, isCreate, saving, errors, impactPrompt, activeSubscribers, featureCatalog, onChange, onCancel, onSave,
}: {
  plan: SubscriptionPlan;
  isCreate: boolean;
  saving: boolean;
  errors: string[];
  impactPrompt: ImpactPrompt | null;
  activeSubscribers: number;
  featureCatalog: { key: string; label: string; requiredPlanKey?: string }[];
  onChange: (plan: SubscriptionPlan) => void;
  onCancel: () => void;
  onSave: (acknowledgeSubscriberImpact: boolean) => void;
}) {
  const set = (patch: Partial<SubscriptionPlan>) => onChange({ ...plan, ...patch });
  const setEnt = (patch: Partial<SubscriptionPlanEntitlements>) => onChange({ ...plan, entitlements: { ...plan.entitlements, ...patch } });
  const toggleFeature = (key: string) => {
    const has = plan.entitlements.featureKeys.includes(key);
    setEnt({ featureKeys: has ? plan.entitlements.featureKeys.filter((k) => k !== key) : [...plan.entitlements.featureKeys, key] });
  };
  const num = (value: string) => (value === "" ? 0 : Math.round(Number(value)));

  return (
    <>
      <Modal
        open
        onClose={onCancel}
        size="lg"
        title={isCreate ? "New package" : `Edit ${plan.name}`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
            <Button size="sm" loading={saving} onClick={() => onSave(false)}>{isCreate ? "Create package" : "Save & publish"}</Button>
          </>
        }
      >
        <div className="space-y-5">
          {errors.length > 0 && (
            <div className="bg-danger-soft border border-danger/30 rounded-lg p-3 text-sm text-danger space-y-1">
              {errors.map((e, i) => <p key={i}>• {e}</p>)}
            </div>
          )}
          {!isCreate && activeSubscribers > 0 && (
            <div className="bg-warning-soft border border-warning/30 rounded-lg p-3 text-sm text-warning">
              <strong>{activeSubscribers}</strong> active / trialing {activeSubscribers === 1 ? "subscriber is" : "subscribers are"} on this
              package. Price changes affect only new checkouts; <strong>entitlement and feature changes take effect for existing subscribers</strong>.
              You&rsquo;ll confirm before an entitlement change saves.
            </div>
          )}

          <Section title="General">
            <Grid>
              <FormField label="Public package name"><Input value={plan.name} onChange={(e) => set({ name: e.target.value })} /></FormField>
              <FormField label="Key / slug" hint="lowercase, digits, underscores">
                <Input
                  value={plan.key}
                  onChange={(e) => set({ key: e.target.value.trim() })}
                  onBlur={() => { if (isCreate && !plan.id && plan.key) set({ id: `plan_${plan.key}` }); }}
                />
              </FormField>
              <FormField label="Internal id" hint="Immutable after creation">
                <Input value={plan.id} disabled={!isCreate} onChange={(e) => set({ id: e.target.value.trim() })} />
              </FormField>
              <FormField label="Display order"><Input type="number" value={plan.displayOrder} onChange={(e) => set({ displayOrder: num(e.target.value) })} /></FormField>
            </Grid>
            <FormField label="Short description (shown on pricing page)">
              <Textarea rows={2} value={plan.summary} onChange={(e) => set({ summary: e.target.value })} />
            </FormField>
            <Grid>
              <FormField label="Badge / recommended label" hint='e.g. "Most popular"'>
                <Input value={plan.badgeLabel} onChange={(e) => set({ badgeLabel: e.target.value })} />
              </FormField>
              <FormField label="Status">
                <label className="flex items-center gap-2 text-sm text-fg-muted h-9">
                  <input type="checkbox" checked={plan.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                  Active (available for new purchases)
                </label>
              </FormField>
            </Grid>
          </Section>

          <Section title="Pricing">
            <Grid>
              <FormField label={`Price (${plan.currencyCode || "PKR"} per ${plan.billingInterval})`}>
                <Input type="number" min={0} step="0.01" value={plan.amountCents / 100} onChange={(e) => set({ amountCents: Math.round(Number(e.target.value || 0) * 100) })} />
              </FormField>
              <FormField label="Currency (ISO code)"><Input value={plan.currencyCode} onChange={(e) => set({ currencyCode: e.target.value.toUpperCase().trim() })} /></FormField>
              <FormField label="Billing interval">
                <Select value={plan.billingInterval} onChange={(e) => set({ billingInterval: e.target.value as BillingInterval })}>
                  <option value="month">month</option><option value="year">year</option>
                </Select>
              </FormField>
              <FormField label="Trial days"><Input type="number" min={0} value={plan.trialDays} onChange={(e) => set({ trialDays: num(e.target.value) })} /></FormField>
            </Grid>
          </Section>

          <Section title="Limits & entitlements">
            <Grid>
              {ENTITLEMENT_FIELDS.map((f) => {
                const isMoney = MONEY_ENT.has(f.key as string);
                const rawValue = plan.entitlements[f.key];
                const displayValue = rawValue === null || rawValue === undefined ? "" : isMoney ? (rawValue as number) / 100 : (rawValue as number);
                return (
                  <FormField key={f.key as string} label={isMoney ? `${f.label} (${plan.currencyCode})` : f.label} hint={f.help}>
                    <Input
                      type="number" min={0} step={isMoney ? "0.01" : "1"} placeholder={f.nullable ? "no limit" : "0"}
                      value={displayValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "" && f.nullable) { setEnt({ [f.key]: null } as Partial<SubscriptionPlanEntitlements>); return; }
                        const n = isMoney ? Math.round(Number(v || 0) * 100) : Math.round(Number(v || 0));
                        setEnt({ [f.key]: n } as Partial<SubscriptionPlanEntitlements>);
                      }}
                    />
                  </FormField>
                );
              })}
            </Grid>
          </Section>

          <Section title="Features">
            <p className="text-xs text-fg-subtle mb-2">Ticked features are unlocked for salons on this package. Unticking removes access on the next request.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {featureCatalog.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm text-fg-muted border border-border rounded-lg px-3 py-2 cursor-pointer hover:bg-surface-hover">
                  <input type="checkbox" checked={plan.entitlements.featureKeys.includes(f.key)} onChange={() => toggleFeature(f.key)} />
                  <span>{f.label}</span>
                  <span className="text-[10px] font-mono text-fg-subtle ml-auto">{f.key}</span>
                </label>
              ))}
            </div>
          </Section>
        </div>
      </Modal>

      <Modal
        open={!!impactPrompt}
        onClose={onCancel}
        size="sm"
        title="Confirm entitlement change"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
            <Button size="sm" className="bg-warning hover:brightness-95 text-white" loading={saving} onClick={() => onSave(true)}>
              I understand, publish
            </Button>
          </>
        }
      >
        {impactPrompt && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              This change affects <strong className="text-fg">{impactPrompt.activeSubscribers}</strong> active / trialing{" "}
              {impactPrompt.activeSubscribers === 1 ? "subscriber" : "subscribers"}. Feature and limit changes are evaluated live —
              their access changes on the next request.
            </p>
            {impactPrompt.changes.length > 0 && (
              <div className="bg-surface-2 rounded-lg p-3 text-xs font-mono text-fg-muted space-y-1 max-h-40 overflow-y-auto">
                {impactPrompt.changes.map((c, i) => <p key={i}>{c}</p>)}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}
