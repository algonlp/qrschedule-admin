"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard, SectionCard } from "@/components/ui/Card";
import { SkeletonStats, ErrorCard, EmptyState } from "@/components/ui/feedback";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/components/ui/utils";

type Stats = {
  totalRevenue: number;
  monthlyRevenue: number;
  activeSubscriptions: number;
  totalCustomers: number;
  failedPayments: number;
  totalCharges: number;
  recentPayments: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    salonName: string;
    customerEmail: string;
    created: string;
    receiptUrl: string | null;
    failureMessage: string | null;
  }[];
};

type Analytics = {
  revenueChart: { month: string; label: string; revenue: number; bookings: number; newSalons: number }[];
  dailyBookings: { date: string; label: string; bookings: number }[];
  topSalons: { id: string; name: string; count: number; revenue: number }[];
  statusDistribution: { name: string; value: number }[];
  totals: { totalSalons: number; activeSalons: number; totalAppointments: number; totalRevenue: number };
};

const CHART = { revenue: "#4f46e5", bookings: "#0ea5e9", bar: "#4f46e5" };
const PIE_COLORS = ["#4f46e5", "#0f9d68", "#dc2626", "#d97706", "#7c3aed", "#db2777"];
const GRID = "rgba(120,120,135,0.18)";
const AXIS = "rgba(120,120,135,0.7)";

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

const tooltipStyle = {
  borderRadius: "10px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--fg)",
  fontSize: "12px",
  boxShadow: "var(--shadow-md)",
};

export default function DashboardOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    Promise.all([
      fetch("/api/stripe/stats").then((r) => r.json()),
      fetch("/api/supabase/analytics").then((r) => r.json()),
    ])
      .then(([stripeData, analyticsData]) => {
        if (stripeData.error) setError(stripeData.error);
        else setStats(stripeData);
        if (!analyticsData.error) setAnalytics(analyticsData);
      })
      .catch(() => setError("Failed to load dashboard"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const money = (n: number, c = "USD") =>
    `${c === "USD" ? "$" : c.toUpperCase() + " "}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Overview" description="QR Schedule platform health at a glance." />

      {loading ? (
        <SkeletonStats count={4} />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => { setError(""); setLoading(true); load(); }} />
      ) : stats ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              label="Total revenue"
              value={money(stats.totalRevenue)}
              icon="payments"
              accent="success"
              hint={`${money(stats.monthlyRevenue)} this month`}
            />
            <StatCard
              label="Active subscriptions"
              value={stats.activeSubscriptions.toLocaleString()}
              icon="subscriptions"
              hint={`${stats.totalCharges} total charges`}
            />
            <StatCard
              label="Salons"
              value={(analytics?.totals.totalSalons ?? stats.totalCustomers).toLocaleString()}
              icon="salons"
              hint={`${analytics?.totals.activeSalons ?? 0} active`}
            />
            <StatCard
              label="Bookings"
              value={(analytics?.totals.totalAppointments ?? 0).toLocaleString()}
              icon="bookings"
              accent={stats.failedPayments > 0 ? "warning" : "primary"}
              hint={`${money(analytics?.totals.totalRevenue ?? 0, "PKR")} booking revenue`}
            />
          </div>

          {analytics && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <SectionCard title="Revenue & bookings trend" bodyClassName="p-4">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={analytics.revenueChart}>
                      <defs>
                        <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART.revenue} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={CHART.revenue} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gBook" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART.bookings} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={CHART.bookings} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} />
                      <YAxis yAxisId="l" tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} width={38} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} width={30} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Area yAxisId="l" type="monotone" dataKey="revenue" name="Revenue" stroke={CHART.revenue} strokeWidth={2} fill="url(#gRev)" />
                      <Area yAxisId="r" type="monotone" dataKey="bookings" name="Bookings" stroke={CHART.bookings} strokeWidth={2} fill="url(#gBook)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </SectionCard>

                <SectionCard title="Daily bookings" description="Last 30 days" bodyClassName="p-4">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={analytics.dailyBookings}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} stroke={GRID} interval={4} />
                      <YAxis tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} allowDecimals={false} width={28} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(120,120,135,0.08)" }} />
                      <Bar dataKey="bookings" name="Bookings" fill={CHART.bar} radius={[4, 4, 0, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </SectionCard>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <SectionCard
                  title="Top performing salons"
                  description="Ranked by total bookings"
                  className="lg:col-span-2"
                  bodyClassName="p-2"
                >
                  {analytics.topSalons.length === 0 ? (
                    <EmptyState icon="salons" title="No salon data yet" />
                  ) : (
                    <ol className="divide-y divide-border">
                      {analytics.topSalons.map((s, i) => {
                        const rankStyle =
                          i === 0
                            ? "bg-warning-soft text-warning"
                            : i === 1
                              ? "bg-surface-2 text-fg-muted"
                              : i === 2
                                ? "bg-primary-soft text-primary"
                                : "bg-transparent text-fg-subtle";
                        return (
                          <li key={s.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-hover/60">
                            <span className={cn("w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold tabular-nums shrink-0", rankStyle)}>
                              {i + 1}
                            </span>
                            <div className="w-8 h-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center font-bold text-xs shrink-0">
                              {s.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-fg truncate">{s.name}</p>
                              <div className="mt-1.5 flex items-center gap-2">
                                <div className="h-1.5 flex-1 rounded-full bg-surface-2 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-primary"
                                    style={{ width: `${(s.count / (analytics.topSalons[0]?.count || 1)) * 100}%` }}
                                  />
                                </div>
                                <span className="text-xs text-fg-subtle shrink-0 tabular-nums">{s.count}</span>
                              </div>
                            </div>
                            <span className="text-sm font-semibold text-success shrink-0 tabular-nums">
                              PKR {s.revenue.toLocaleString()}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </SectionCard>

                <SectionCard title="Booking status" bodyClassName="p-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={analytics.statusDistribution} cx="50%" cy="50%" innerRadius={46} outerRadius={72} paddingAngle={3} dataKey="value">
                        {analytics.statusDistribution.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="var(--surface)" strokeWidth={2} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-3">
                    {analytics.statusDistribution.map((item, i) => (
                      <div key={item.name} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-fg-muted capitalize">
                          <span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          {item.name}
                        </span>
                        <span className="font-semibold text-fg tabular-nums">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>
            </>
          )}

          <SectionCard
            title="Recent payments"
            description={`Latest ${stats.recentPayments.length} transaction${stats.recentPayments.length === 1 ? "" : "s"} across all salons`}
            action={
              <Link
                href="/dashboard/payments"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View all
                <Icon name="chevron-right" className="w-3.5 h-3.5" />
              </Link>
            }
            bodyClassName="p-0"
          >
            {stats.recentPayments.length === 0 ? (
              <EmptyState icon="payments" title="No payments yet" />
            ) : (
              <Table>
                <THead>
                  <TH>Salon</TH>
                  <TH align="right">Amount</TH>
                  <TH>Status</TH>
                  <TH align="right">Date</TH>
                  <TH align="right">Receipt</TH>
                </THead>
                <TBody>
                  {stats.recentPayments.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center font-bold text-xs shrink-0">
                            {p.salonName.charAt(0).toUpperCase() || "?"}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-fg truncate">{p.salonName}</p>
                            <p className="text-xs text-fg-subtle truncate">{p.customerEmail}</p>
                          </div>
                        </div>
                      </TD>
                      <TD align="right">
                        <span className="text-sm font-semibold text-fg tabular-nums">${p.amount.toFixed(2)}</span>
                        <span className="text-xs text-fg-subtle ml-1">{p.currency.toUpperCase()}</span>
                      </TD>
                      <TD>
                        <StatusBadge status={p.status} dot />
                        {p.failureMessage && <p className="text-xs text-danger mt-1 max-w-[16rem]">{p.failureMessage}</p>}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        <span className="text-sm text-fg-muted">{relativeTime(p.created)}</span>
                        <p className="text-xs text-fg-subtle">
                          {new Date(p.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </TD>
                      <TD align="right">
                        {p.receiptUrl ? (
                          <a
                            href={p.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-medium"
                          >
                            Receipt
                            <Icon name="external" className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
