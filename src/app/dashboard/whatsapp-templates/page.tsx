"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { languageAliases, metaStatusLabel, type QrTemplateStatus } from "@/lib/whatsapp-templates";

// ---------------------------------------------------------------------------
// Response types (mirror src/lib/whatsapp-template-service.ts view models)
// ---------------------------------------------------------------------------
type Compatibility = { compatible: boolean; satisfied: string[]; missing: string[] };

type AssignmentView = {
  purpose: string;
  purposeLabel: string;
  group: string;
  plan: string;
  planLabel: string;
  businessId: string;
  salonName: string | null;
  language: string;
  isActive: boolean;
  pricingCategory: string;
  compatibility: Compatibility;
};

type Usage = {
  tracked: boolean;
  window: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  lastUsedAt: string | null;
  lastError: string | null;
};

type TemplateView = {
  id: string;
  name: string;
  language: string;
  category: string;
  metaStatus: string;
  metaTemplateId: string | null;
  qrStatus: QrTemplateStatus;
  archived: boolean;
  adminNotes: string;
  lastSyncedAt: string | null;
  createdVia: string;
  content: {
    headerText?: string;
    headerFormat?: string;
    body: string;
    footerText?: string;
    buttons: { type: string; text: string; dynamic?: boolean }[];
    variables: { position: number; key: string; label: string }[];
  };
  rejectedReason: string | null;
  assignedTo: AssignmentView[];
  usage: Usage;
};

type PlanOption = { key: string; label: string; isActive: boolean; order: number };
type SalonOption = { id: string; name: string };

type MatrixPurpose = {
  key: string;
  label: string;
  group: string;
  pricingCategory: string;
  availableVariableKeys: string[];
  defaultTemplateName: string;
  backendWired: boolean;
};

type MatrixCell = {
  purpose: string;
  plan: string;
  language: string;
  assignedTemplateName: string | null;
  assignedLanguage: string | null;
  assignmentActive: boolean;
  assignmentCompatible: boolean;
  resolvedTemplateName: string;
  resolvedVia: "plan" | "global" | "fallback";
  resolvedMetaStatus: string | null;
  sendable: boolean;
  candidateCount: number;
};

type MatrixView = {
  language: string;
  plans: PlanOption[];
  purposes: MatrixPurpose[];
  cells: MatrixCell[];
};

type MetaStatus = {
  configured: boolean;
  missing: string[];
  apiVersion: string;
  tokenHint: string | null;
  wabaIdHint: string | null;
  submitAllowed: boolean;
};

type ApiData = {
  templates: TemplateView[];
  plans: PlanOption[];
  salons: SalonOption[];
  matrices: MatrixView[];
  meta: MetaStatus;
  provisioned: boolean;
};

// ---------------------------------------------------------------------------
const QR_STATUS_STYLE: Record<QrTemplateStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300",
  inactive: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300",
  unassigned: "bg-surface-2 text-fg-subtle border-border",
};

const VIA_STYLE: Record<MatrixCell["resolvedVia"], string> = {
  plan: "bg-emerald-50 text-emerald-700 border-emerald-200",
  global: "bg-primary-soft text-primary border-transparent",
  fallback: "bg-gray-100 text-fg-subtle border-gray-200",
};

function metaStatusStyle(status: string): string {
  if (status === "APPROVED") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "PENDING" || status === "IN_APPEAL") return "bg-primary-soft text-primary border-transparent";
  if (status === "UNVERIFIED") return "bg-gray-100 text-fg-subtle border-gray-200";
  return "bg-red-50 text-red-700 border-red-200";
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${className}`}
    >
      {children}
    </span>
  );
}

// ===========================================================================
export default function WhatsappTemplatesPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [tab, setTab] = useState<"matrix" | "templates">("matrix");
  const [syncing, setSyncing] = useState(false);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [langFilter, setLangFilter] = useState("all");

  const [matrixLang, setMatrixLang] = useState("en_US");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);

  const load = useCallback(() => {
    fetch("/api/supabase/whatsapp/templates")
      .then((r) => r.json())
      .then((d: { data?: ApiData; error?: string }) => {
        if (d.error || !d.data) {
          setError(d.error || "Failed to load");
          return;
        }
        setError("");
        setData(d.data);
      })
      .catch(() => setError("Failed to load WhatsApp templates"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runSync() {
    setSyncing(true);
    setBanner("");
    try {
      const res = await fetch("/api/supabase/whatsapp/templates/sync", { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        setBanner(`Sync failed: ${d.error ?? "unknown error"}`);
        return;
      }
      const r = d.data;
      setBanner(
        `Synced ${r.fetched} template(s) from Meta — ${r.added.length} added, ${r.updated.length} updated, ` +
          `${r.statusChanges.length} status change(s)` +
          (r.markedNotFound.length ? `, ${r.markedNotFound.length} marked NOT_FOUND` : "") +
          ".",
      );
      load();
    } catch {
      setBanner("Network error during sync");
    } finally {
      setSyncing(false);
    }
  }

  async function mutate(templateId: string, body: Record<string, unknown>): Promise<boolean> {
    setBanner("");
    try {
      const res = await fetch(
        `/api/supabase/whatsapp/templates/${encodeURIComponent(templateId)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      const d = await res.json();
      if (!res.ok) {
        setBanner(d.error ?? "Action failed");
        return false;
      }
      setBanner(d.data?.note ?? "Done.");
      load();
      return true;
    } catch {
      setBanner("Network error");
      return false;
    }
  }

  const templates = useMemo(() => data?.templates ?? [], [data]);
  const matrices = useMemo(() => data?.matrices ?? [], [data]);
  const meta = data?.meta;

  const matrix = useMemo(
    () => matrices.find((m) => m.language === matrixLang) ?? matrices[0],
    [matrices, matrixLang],
  );

  const languages = useMemo(
    () => Array.from(new Set(templates.map((t) => t.language))).sort(),
    [templates],
  );
  const categories = useMemo(
    () => Array.from(new Set(templates.map((t) => t.category).filter(Boolean))).sort(),
    [templates],
  );

  const filtered = templates.filter((t) => {
    if (q && !`${t.name} ${t.content.body}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (statusFilter !== "all" && t.metaStatus !== statusFilter) return false;
    if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
    if (langFilter !== "all" && t.language !== langFilter) return false;
    return true;
  });

  const open = templates.find((t) => t.id === openId) ?? null;
  const allPurposes = matrices[0]?.purposes ?? [];

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
          <p className="text-red-700 dark:text-red-400 font-medium">{error}</p>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-fg hover:bg-primary-hover cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-5">
      <p className="text-sm text-fg-muted">
        Control which approved Meta WhatsApp template each messaging purpose uses — per subscription
        plan and language. Meta stays authoritative for template content and status; QR Schedule
        controls only the assignment. This never changes the WhatsApp channel switch or message
        pricing (pricing follows the purpose, not the template).
      </p>

      {!data.provisioned && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-800 dark:text-red-200 space-y-2">
          <p>
            <strong>One-time setup needed.</strong> The WhatsApp template registry tables do not
            exist in the database yet.
          </p>
          <ol className="list-decimal ml-5 space-y-1">
            <li>
              Supabase dashboard → SQL editor → run{" "}
              <code className="text-xs">supabase/whatsapp-template-registry.sql</code>.
            </li>
            <li>
              Backend repo: <code className="text-xs">npm run seed:whatsapp-templates</code>.
            </li>
            <li>Reload, then click “Sync from Meta”.</li>
          </ol>
        </div>
      )}

      {meta && !meta.configured && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <strong>Meta WhatsApp is not connected in this environment.</strong> Set{" "}
          {meta.missing.join(" and ")} to enable “Sync from Meta”. Existing templates are shown;
          sending stays unavailable until the provider is configured on qrschedule.com.
        </div>
      )}
      {meta && meta.configured && (
        <div className="text-xs text-fg-subtle">
          Meta connected · Graph API {meta.apiVersion} · token {meta.tokenHint} · WABA{" "}
          {meta.wabaIdHint} ·{" "}
          {meta.submitAllowed ? (
            <span className="text-amber-600">Meta writes enabled</span>
          ) : (
            <span className="text-emerald-600">read-only against Meta</span>
          )}
        </div>
      )}

      {banner && (
        <div className="bg-info-soft border border-info/30 rounded-lg px-4 py-2.5 text-sm text-info">
          {banner}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={runSync}
          disabled={syncing || !meta?.configured || !data.provisioned}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title={!data.provisioned ? "Run the database setup first" : meta?.configured ? "" : "Connect Meta to sync"}
        >
          {syncing ? "Syncing…" : "Sync from Meta"}
        </button>
        <button
          onClick={() => setShowSubmit(true)}
          disabled={!meta?.configured || !meta?.submitAllowed || !data.provisioned}
          title={
            meta?.submitAllowed ? "" : "Read-only against Meta — set WHATSAPP_ALLOW_META_SUBMIT=true to enable"
          }
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-surface-2 text-fg-muted hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Submit new version
        </button>
        <div className="flex-1" />
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
          {(["matrix", "templates"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 cursor-pointer ${
                tab === t ? "bg-primary text-primary-fg" : "bg-surface text-fg-muted"
              }`}
            >
              {t === "matrix" ? "Assignment matrix" : "Templates"}
            </button>
          ))}
        </div>
      </div>

      {tab === "matrix" ? (
        <MatrixPanel
          matrix={matrix}
          allMatrices={matrices}
          matrixLang={matrixLang}
          setMatrixLang={setMatrixLang}
          templates={templates}
          onMutate={mutate}
        />
      ) : (
        <TemplatesPanel
          templates={filtered}
          total={templates.length}
          q={q}
          setQ={setQ}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          langFilter={langFilter}
          setLangFilter={setLangFilter}
          categories={categories}
          languages={languages}
          onOpen={setOpenId}
        />
      )}

      {open && (
        <TemplateDrawer
          template={open}
          plans={data.plans}
          salons={data.salons ?? []}
          purposes={allPurposes}
          onClose={() => setOpenId(null)}
          onMutate={mutate}
          metaConfigured={Boolean(meta?.configured)}
        />
      )}

      {showSubmit && (
        <SubmitModal
          onClose={() => setShowSubmit(false)}
          onDone={(msg) => {
            setShowSubmit(false);
            setBanner(msg);
            load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg"
    >
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Assignment matrix — Purpose (rows) × Plan (columns)
// ---------------------------------------------------------------------------
function MatrixPanel({
  matrix,
  allMatrices,
  matrixLang,
  setMatrixLang,
  templates,
  onMutate,
}: {
  matrix: MatrixView | undefined;
  allMatrices: MatrixView[];
  matrixLang: string;
  setMatrixLang: (l: string) => void;
  templates: TemplateView[];
  onMutate: (id: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<{ purpose: string; plan: string } | null>(null);

  if (!matrix) return <p className="text-sm text-fg-subtle">No matrix data.</p>;

  const cell = (purpose: string, plan: string) =>
    matrix.cells.find((c) => c.purpose === purpose && c.plan === plan);

  const purpose = editing ? matrix.purposes.find((p) => p.key === editing.purpose) : undefined;
  const editingCell = editing ? cell(editing.purpose, editing.plan) : undefined;

  const groups = Array.from(new Set(matrix.purposes.map((p) => p.group)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={matrixLang} onChange={setMatrixLang} label="Language">
          {allMatrices.map((m) => (
            <option key={m.language} value={m.language}>
              {m.language}
            </option>
          ))}
        </Select>
        <p className="text-xs text-fg-subtle">
          Each cell shows what the backend resolver would send for that plan + purpose. Precedence:
          plan assignment → global (Any plan) → shipped fallback. Click a cell to assign or change it.
        </p>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-fg-subtle uppercase border-b border-border">
              <th className="text-left px-4 py-2.5 sticky left-0 bg-surface">Purpose</th>
              {matrix.plans.map((p) => (
                <th key={p.key} className="text-left px-3 py-2.5 whitespace-nowrap">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groups.map((g) => (
              <FragmentRows
                key={g}
                group={g}
                purposes={matrix.purposes.filter((p) => p.group === g)}
                plans={matrix.plans}
                cellOf={cell}
                onPick={(purposeKey, planKey) => setEditing({ purpose: purposeKey, plan: planKey })}
                active={editing}
              />
            ))}
          </tbody>
        </table>
      </div>

      {editing && purpose && (
        <CellEditor
          purpose={purpose}
          plan={editing.plan}
          planLabel={matrix.plans.find((p) => p.key === editing.plan)?.label ?? editing.plan}
          language={matrix.language}
          cell={editingCell}
          templates={templates}
          onClose={() => setEditing(null)}
          onMutate={onMutate}
        />
      )}
    </div>
  );
}

function FragmentRows({
  group,
  purposes,
  plans,
  cellOf,
  onPick,
  active,
}: {
  group: string;
  purposes: MatrixPurpose[];
  plans: PlanOption[];
  cellOf: (purpose: string, plan: string) => MatrixCell | undefined;
  onPick: (purpose: string, plan: string) => void;
  active: { purpose: string; plan: string } | null;
}) {
  return (
    <>
      <tr className="bg-surface-2/40">
        <td
          colSpan={plans.length + 1}
          className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle"
        >
          {group}
        </td>
      </tr>
      {purposes.map((p) => (
        <tr key={p.key}>
          <td className="px-4 py-2.5 sticky left-0 bg-surface">
            <div className="font-medium text-fg">{p.label}</div>
            <div className="text-[11px] text-fg-subtle">
              {p.pricingCategory} pricing
              {!p.backendWired && <span className="ml-1 text-amber-500">· not wired yet</span>}
            </div>
          </td>
          {plans.map((plan) => {
            const c = cellOf(p.key, plan.key);
            const isActive = active?.purpose === p.key && active?.plan === plan.key;
            return (
              <td key={plan.key} className="px-3 py-2">
                <button
                  onClick={() => onPick(p.key, plan.key)}
                  className={`text-left w-full rounded-lg border px-2 py-1.5 text-xs transition-colors cursor-pointer ${
                    isActive
                      ? "border-blue-500 ring-1 ring-blue-500"
                      : "border-border hover:border-blue-300"
                  }`}
                >
                  <div className="font-mono text-[11px] truncate max-w-[150px] text-fg">
                    {c?.resolvedTemplateName ?? "—"}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1">
                    {c && (
                      <span
                        className={`inline-block text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded-full border ${VIA_STYLE[c.resolvedVia]}`}
                      >
                        {c.resolvedVia}
                      </span>
                    )}
                    {c?.assignedTemplateName && !c.assignmentActive && (
                      <span className="text-[9px] text-amber-500">off</span>
                    )}
                    {c && c.candidateCount === 0 && !c.assignedTemplateName && (
                      <span className="text-[9px] text-fg-subtle">no template</span>
                    )}
                  </div>
                </button>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function CellEditor({
  purpose,
  plan,
  planLabel,
  language,
  cell,
  templates,
  onClose,
  onMutate,
}: {
  purpose: MatrixPurpose;
  plan: string;
  planLabel: string;
  language: string;
  cell: MatrixCell | undefined;
  templates: TemplateView[];
  onClose: () => void;
  onMutate: (id: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [pick, setPick] = useState("");
  const langOk = (l: string) => languageAliases(language).includes(l);
  const varsFit = (t: TemplateView) => {
    const keys = t.content.variables.map((v) => v.key);
    const positional = keys.length > 0 && keys.every((k) => /^var\d+$/.test(k));
    return positional
      ? keys.length === purpose.availableVariableKeys.length
      : keys.every((k) => purpose.availableVariableKeys.includes(k));
  };

  const approvedHere = templates.filter((t) => langOk(t.language) && t.metaStatus === "APPROVED");
  const candidates = approvedHere.filter(varsFit);
  const incompatibleApproved = approvedHere.filter((t) => !varsFit(t));

  const assignLang = cell?.assignedLanguage ?? language;
  const currentTemplate = cell?.assignedTemplateName
    ? templates.find((t) => t.name === cell.assignedTemplateName && langOk(t.language))
    : undefined;

  return (
    <div className="bg-surface rounded-xl border border-blue-200 dark:border-blue-800 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-fg">
            {purpose.label} → {planLabel}{" "}
            <span className="text-xs font-normal text-fg-subtle">({language})</span>
          </h3>
          <p className="text-xs text-fg-subtle mt-0.5">
            Currently resolves to <code>{cell?.resolvedTemplateName}</code>{" "}
            <span className="uppercase text-[10px]">({cell?.resolvedVia})</span>
            {" · "}
            {purpose.availableVariableKeys.length} variables available: {purpose.availableVariableKeys.join(", ")}
          </p>
        </div>
        <button onClick={onClose} className="text-fg-subtle hover:text-gray-600 cursor-pointer text-lg leading-none">
          ×
        </button>
      </div>

      {cell?.assignedTemplateName && (
        <div className="text-sm flex items-center gap-2 flex-wrap">
          <span className="text-fg-subtle">Assigned:</span>
          <code>{cell.assignedTemplateName}</code>
          <Badge className={cell.assignmentActive ? QR_STATUS_STYLE.active : QR_STATUS_STYLE.inactive}>
            {cell.assignmentActive ? "active" : "inactive"}
          </Badge>
          {currentTemplate && (
            <Badge className={metaStatusStyle(currentTemplate.metaStatus)}>
              {metaStatusLabel(currentTemplate.metaStatus)}
            </Badge>
          )}
          <button
            onClick={() =>
              onMutate(`${cell.assignedTemplateName}__${assignLang}`, {
                action: cell.assignmentActive ? "deactivate" : "activate",
                purpose: purpose.key,
                plan,
                language: assignLang,
              })
            }
            className="text-xs font-medium text-primary hover:underline cursor-pointer"
          >
            {cell.assignmentActive ? "Deactivate" : "Activate"}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="flex-1 min-w-[220px] px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg"
        >
          <option value="">
            {candidates.length ? "Assign / change template…" : "No compatible approved template"}
          </option>
          {candidates.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
          {incompatibleApproved.length > 0 && (
            <optgroup label="Approved but missing variables">
              {incompatibleApproved.map((t) => (
                <option key={t.id} value={t.name} disabled>
                  {t.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          disabled={!pick}
          onClick={async () => {
            const t = candidates.find((x) => x.name === pick);
            if (!t) return;
            const ok = await onMutate(t.id, {
              action: "assign",
              purpose: purpose.key,
              plan,
              language: t.language,
              activate: true,
            });
            if (ok) {
              setPick("");
              onClose();
            }
          }}
          className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
        >
          Assign &amp; activate
        </button>
      </div>

      {plan !== "*" && (
        <p className="text-xs text-fg-subtle">
          A plan-specific assignment overrides the “Any plan” row for {planLabel} only. Other plans
          keep resolving through their own assignment or the global one.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function TemplatesPanel({
  templates,
  total,
  q,
  setQ,
  statusFilter,
  setStatusFilter,
  categoryFilter,
  setCategoryFilter,
  langFilter,
  setLangFilter,
  categories,
  languages,
  onOpen,
}: {
  templates: TemplateView[];
  total: number;
  q: string;
  setQ: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  langFilter: string;
  setLangFilter: (v: string) => void;
  categories: string[];
  languages: string[];
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or body…"
          className="px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg flex-1 min-w-[180px]"
        />
        <Select value={statusFilter} onChange={setStatusFilter} label="Meta status">
          <option value="all">All Meta statuses</option>
          {["APPROVED", "PENDING", "REJECTED", "DISABLED", "PAUSED", "UNVERIFIED", "NOT_FOUND"].map((s) => (
            <option key={s} value={s}>
              {metaStatusLabel(s)}
            </option>
          ))}
        </Select>
        <Select value={categoryFilter} onChange={setCategoryFilter} label="Category">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={langFilter} onChange={setLangFilter} label="Language">
          <option value="all">All languages</option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-fg-subtle uppercase border-b border-border">
              <th className="text-left px-4 py-2.5">Template</th>
              <th className="text-left px-4 py-2.5">Category</th>
              <th className="text-left px-4 py-2.5">Lang</th>
              <th className="text-left px-4 py-2.5">Meta status</th>
              <th className="text-left px-4 py-2.5">QR status</th>
              <th className="text-left px-4 py-2.5">Assigned to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {templates.map((t) => (
              <tr
                key={t.id}
                onClick={() => onOpen(t.id)}
                className="cursor-pointer hover:bg-surface-hover"
              >
                <td className="px-4 py-3 font-medium text-fg">
                  {t.name}
                  {t.archived && <span className="ml-2 text-xs text-fg-subtle">(archived)</span>}
                  {t.createdVia === "admin-submit" && (
                    <span className="ml-2 text-[10px] text-blue-500">submitted</span>
                  )}
                </td>
                <td className="px-4 py-3 text-fg-subtle">{t.category || "—"}</td>
                <td className="px-4 py-3 text-fg-subtle">{t.language}</td>
                <td className="px-4 py-3">
                  <Badge className={metaStatusStyle(t.metaStatus)}>{metaStatusLabel(t.metaStatus)}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge className={QR_STATUS_STYLE[t.qrStatus]}>{t.qrStatus}</Badge>
                </td>
                <td className="px-4 py-3 text-fg-subtle">
                  {t.assignedTo.length === 0
                    ? "—"
                    : t.assignedTo
                        .map(
                          (a) =>
                            `${a.purposeLabel} · ${a.salonName ? `🏠 ${a.salonName}` : a.planLabel}${
                              a.isActive ? "" : " (off)"
                            }`,
                        )
                        .join(", ")}
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-fg-subtle">
                  {total === 0 ? "No templates yet — click “Sync from Meta”." : "No templates match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function TemplateDrawer({
  template: t,
  plans,
  salons,
  purposes,
  onClose,
  onMutate,
  metaConfigured,
}: {
  template: TemplateView;
  plans: PlanOption[];
  salons: SalonOption[];
  purposes: MatrixPurpose[];
  onClose: () => void;
  onMutate: (id: string, body: Record<string, unknown>) => Promise<boolean>;
  metaConfigured: boolean;
}) {
  const [notes, setNotes] = useState(t.adminNotes);
  const [confirmStop, setConfirmStop] = useState(false);

  const activeAssignments = t.assignedTo.filter((a) => a.isActive);

  // --- Assign this template to a purpose + (plan or salon), from the drawer ---
  const varsFit = (p: MatrixPurpose) => {
    const keys = t.content.variables.map((v) => v.key);
    const positional = keys.length > 0 && keys.every((k) => /^var\d+$/.test(k));
    return positional
      ? keys.length === p.availableVariableKeys.length
      : keys.every((k) => p.availableVariableKeys.includes(k));
  };
  const compatiblePurposes = purposes.filter(varsFit);
  const [assignPurpose, setAssignPurpose] = useState(
    compatiblePurposes.length === 1 ? compatiblePurposes[0].key : "",
  );
  const [assignScope, setAssignScope] = useState<"plan" | "salon">("plan");
  const [assignPlan, setAssignPlan] = useState("*");
  const [assignSalon, setAssignSalon] = useState("");
  const [salonQuery, setSalonQuery] = useState("");
  const [assigning, setAssigning] = useState(false);

  const filteredSalons = salonQuery.trim()
    ? salons.filter((s) => s.name.toLowerCase().includes(salonQuery.trim().toLowerCase()))
    : salons;

  function resetAssign() {
    setAssignPurpose(compatiblePurposes.length === 1 ? compatiblePurposes[0].key : "");
    setAssignPlan("*");
    setAssignSalon("");
    setSalonQuery("");
  }

  async function doAssign() {
    if (!assignPurpose) return;
    if (assignScope === "salon" && !assignSalon) return;
    setAssigning(true);
    const ok = await onMutate(t.id, {
      action: "assign",
      purpose: assignPurpose,
      language: t.language,
      activate: true,
      ...(assignScope === "salon" ? { businessId: assignSalon } : { plan: assignPlan }),
    });
    setAssigning(false);
    if (ok) resetAssign();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full overflow-y-auto bg-surface p-6 space-y-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-fg">{t.name}</h2>
            <div className="mt-1 flex gap-1.5 flex-wrap">
              <Badge className={metaStatusStyle(t.metaStatus)}>{metaStatusLabel(t.metaStatus)}</Badge>
              <Badge className={QR_STATUS_STYLE[t.qrStatus]}>{t.qrStatus}</Badge>
              <Badge className="bg-gray-100 text-fg-subtle border-gray-200">{t.category || "no category"}</Badge>
              <Badge className="bg-gray-100 text-fg-subtle border-gray-200">{t.language}</Badge>
            </div>
          </div>
          <button onClick={onClose} className="text-fg-subtle hover:text-gray-600 cursor-pointer text-xl leading-none">
            ×
          </button>
        </div>

        <Section title="Template information">
          <Row k="Meta template ID" v={t.metaTemplateId ?? "—"} />
          <Row k="Source" v={t.createdVia} />
          <Row k="Last synced" v={fmtDate(t.lastSyncedAt)} />
          {t.rejectedReason && <Row k="Rejected reason" v={t.rejectedReason} />}
        </Section>

        <Section title="Content preview">
          <div className="rounded-lg bg-surface-2 p-3">
            <div className="bg-surface rounded-lg p-3 text-sm shadow max-w-sm space-y-1.5">
              {t.content.headerText && (
                <div className="font-semibold text-fg">{t.content.headerText}</div>
              )}
              <div className="whitespace-pre-wrap text-fg">{t.content.body}</div>
              {t.content.footerText && <div className="text-xs text-fg-subtle">{t.content.footerText}</div>}
              {t.content.buttons.length > 0 && (
                <div className="pt-1.5 border-t border-border space-y-1">
                  {t.content.buttons.map((b, i) => (
                    <div key={i} className="text-center text-primary text-sm font-medium">
                      {b.text}
                      {b.dynamic ? " ↗" : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {t.content.variables.length > 0 && (
            <div className="mt-2 text-xs text-fg-subtle space-y-0.5">
              {t.content.variables.map((v) => (
                <div key={v.position}>
                  <code>{`{{${v.position}}}`}</code> → {v.key}{" "}
                  <span className="text-fg-subtle">({v.label})</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Assignments">
          {t.assignedTo.length === 0 && (
            <p className="text-sm text-fg-subtle">Not assigned to any purpose or plan yet.</p>
          )}
          {t.assignedTo.map((a) => (
            <div
              key={`${a.purpose}-${a.plan}-${a.businessId}-${a.language}`}
              className="flex items-center justify-between py-1.5"
            >
              <div className="text-sm">
                <span className="text-fg">{a.purposeLabel}</span>{" "}
                <span className="text-xs text-fg-subtle">
                  ({a.salonName ? `salon: ${a.salonName}` : a.planLabel} · {a.language} · {a.pricingCategory})
                </span>
                {a.salonName && (
                  <span className="ml-1 inline-block text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full border bg-primary-soft text-primary border-transparent">
                    salon override
                  </span>
                )}
                {!a.compatibility.compatible && (
                  <span className="ml-1 text-xs text-red-500">missing: {a.compatibility.missing.join(", ")}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge className={a.isActive ? QR_STATUS_STYLE.active : QR_STATUS_STYLE.inactive}>
                  {a.isActive ? "active" : "inactive"}
                </Badge>
                <button
                  onClick={() =>
                    onMutate(t.id, {
                      action: a.isActive ? "deactivate" : "activate",
                      purpose: a.purpose,
                      language: a.language,
                      ...(a.businessId !== "*" ? { businessId: a.businessId } : { plan: a.plan }),
                    })
                  }
                  className="text-xs font-medium text-primary hover:underline cursor-pointer"
                >
                  {a.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          ))}
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-semibold text-fg mb-2">Assign this template</p>

            {t.metaStatus !== "APPROVED" && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                Meta status is {metaStatusLabel(t.metaStatus)} — the assignment is saved but stays
                inactive until Meta approves this template.
              </p>
            )}

            {compatiblePurposes.length === 0 ? (
              <p className="text-xs text-fg-subtle">
                {purposes.length === 0
                  ? "Purpose catalog is unavailable right now."
                  : `This template's variables (${
                      t.content.variables.map((v) => v.key).join(", ") || "none"
                    }) don't match any messaging purpose, so it can't be assigned.`}
              </p>
            ) : (
              <div className="space-y-2">
                {/* Scope: whole plan vs one salon */}
                <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
                  {(["plan", "salon"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setAssignScope(s)}
                      disabled={s === "salon" && salons.length === 0}
                      className={`px-3 py-1.5 cursor-pointer capitalize disabled:opacity-40 disabled:cursor-not-allowed ${
                        assignScope === s ? "bg-primary text-primary-fg" : "bg-surface text-fg-muted"
                      }`}
                    >
                      {s === "plan" ? "By plan" : "By salon"}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Purpose"
                    value={assignPurpose}
                    onChange={(e) => setAssignPurpose(e.target.value)}
                    className="px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg min-w-[180px]"
                  >
                    <option value="">Choose purpose…</option>
                    {compatiblePurposes.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>

                  {assignScope === "plan" ? (
                    <select
                      aria-label="Plan"
                      value={assignPlan}
                      onChange={(e) => setAssignPlan(e.target.value)}
                      className="px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg"
                    >
                      <option value="*">Any plan (global)</option>
                      {plans.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <input
                        value={salonQuery}
                        onChange={(e) => setSalonQuery(e.target.value)}
                        placeholder="Filter salons…"
                        className="px-3 py-1.5 border border-border rounded-lg text-xs bg-surface text-fg w-[220px]"
                      />
                      <select
                        aria-label="Salon"
                        value={assignSalon}
                        onChange={(e) => setAssignSalon(e.target.value)}
                        size={1}
                        className="px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg w-[220px]"
                      >
                        <option value="">
                          {filteredSalons.length ? "Choose salon…" : "No salon matches"}
                        </option>
                        {filteredSalons.slice(0, 200).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <button
                    onClick={doAssign}
                    disabled={
                      !assignPurpose || assigning || (assignScope === "salon" && !assignSalon)
                    }
                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-50 cursor-pointer self-start"
                  >
                    {assigning ? "Assigning…" : "Assign & activate"}
                  </button>
                </div>
              </div>
            )}

            <p className="mt-2 text-[11px] text-fg-subtle">
              Precedence: a <strong>salon</strong> assignment wins for that salon, then a{" "}
              <strong>plan</strong> assignment, then <strong>Any plan</strong>, then the shipped
              default. One active template per purpose + scope + language — assigning replaces the
              previous one.
            </p>
          </div>
        </Section>

        <Section title="Usage">
          {!t.usage.tracked ? (
            <p className="text-sm text-fg-subtle">Usage data unavailable.</p>
          ) : (
            <div className="text-sm text-fg-muted space-y-0.5">
              <Row k="Window" v={t.usage.window} />
              <Row
                k="Total / sent / failed / skipped"
                v={`${t.usage.total} / ${t.usage.sent} / ${t.usage.failed} / ${t.usage.skipped}`}
              />
              <Row k="Last used" v={fmtDate(t.usage.lastUsedAt)} />
              {t.usage.lastError && <Row k="Last error" v={t.usage.lastError} />}
            </div>
          )}
        </Section>

        <Section title="Internal notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg"
            placeholder="Admin-only notes (not sent to Meta)"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => onMutate(t.id, { action: "notes", adminNotes: notes })}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-2 text-fg-muted hover:bg-gray-200 cursor-pointer"
            >
              Save notes
            </button>
            <button
              onClick={() => onMutate(t.id, { action: "notes", archived: !t.archived })}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-2 text-fg-muted hover:bg-gray-200 cursor-pointer"
            >
              {t.archived ? "Unarchive" : "Archive"}
            </button>
          </div>
        </Section>

        <div className="border-t border-border pt-4">
          {!confirmStop ? (
            <button
              onClick={() => setConfirmStop(true)}
              disabled={activeAssignments.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-danger text-white hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Stop using this template
            </button>
          ) : (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-2">
              <p className="text-sm text-red-800 dark:text-red-200">
                This template will no longer be used for customer WhatsApp messages.
                {activeAssignments.length > 0 && (
                  <>
                    {" "}
                    It is currently active for:{" "}
                    <strong>
                      {activeAssignments.map((a) => `${a.purposeLabel} (${a.planLabel})`).join(", ")}
                    </strong>
                    .
                  </>
                )}{" "}
                The Meta template itself is not touched.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await onMutate(t.id, { action: "stop" });
                    setConfirmStop(false);
                  }}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-danger text-white hover:brightness-95 cursor-pointer"
                >
                  Confirm stop
                </button>
                <button
                  onClick={() => setConfirmStop(false)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-2 text-fg-muted cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {!metaConfigured && (
          <p className="text-xs text-fg-subtle">
            Meta is not connected — assignment and activation still work against the shared database,
            but nothing sends until the provider is configured on qrschedule.com.
          </p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm py-0.5">
      <span className="text-fg-subtle">{k}</span>
      <span className="text-fg-muted text-right break-all">{v}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
function SubmitModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("UTILITY");
  const [body, setBody] = useState("");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [replaces, setReplaces] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/supabase/whatsapp/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          body,
          headerText: headerText || undefined,
          footerText: footerText || undefined,
          replacesTemplateName: replaces || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setErr(d.error ?? "Submission failed");
        return;
      }
      onDone(
        `Submitted "${d.data.templateName}" to Meta — status ${d.data.metaStatus}. It stays unusable until Meta approves it and you assign + activate it.`,
      );
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-xl border border-border w-full max-w-lg p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-fg">Submit a new template version to Meta</h3>
        <p className="text-xs text-fg-subtle">
          This creates a brand-new template in Meta (an approved template is never edited in place).
          It lands as <strong>Pending</strong> and cannot be used by QR Schedule until Meta approves
          it and you explicitly assign and activate it.
        </p>
        {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded p-2">{err}</div>}
        <label className="block text-xs text-fg-subtle">
          Template name (lower_snake_case, e.g. appointment_confirmed_v2)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg"
          />
        </label>
        <label className="block text-xs text-fg-subtle">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg"
          >
            <option>UTILITY</option>
            <option>MARKETING</option>
            <option>AUTHENTICATION</option>
          </select>
        </label>
        <label className="block text-xs text-fg-subtle">
          Header text (optional)
          <input
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg"
          />
        </label>
        <label className="block text-xs text-fg-subtle">
          Body (use {"{{1}}"}, {"{{2}}"} … for variables)
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="mt-1 w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg"
          />
        </label>
        <label className="block text-xs text-fg-subtle">
          Footer text (optional)
          <input
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg"
          />
        </label>
        <label className="block text-xs text-fg-subtle">
          Replaces template (optional, for the audit trail)
          <input
            value={replaces}
            onChange={(e) => setReplaces(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-surface-2 text-fg-muted cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !name || !body}
            className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Submitting…" : "Submit to Meta"}
          </button>
        </div>
      </div>
    </div>
  );
}
