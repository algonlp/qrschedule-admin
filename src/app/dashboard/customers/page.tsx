"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { downloadCSV } from "@/lib/export";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, StatCard } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { CenteredSpinner, EmptyState, ErrorCard } from "@/components/ui/feedback";
import { FilterBar } from "@/components/ui/DataTable";
import { cn } from "@/components/ui/utils";

type Customer = {
  id: string; businessId: string; businessName: string; name: string; phone: string; email: string;
  totalVisits: number; bookedVisits: number; completedVisits: number; cancelledVisits: number;
  lastService: string; lastAppointmentDate: string; lastAppointmentTime: string;
  firstSeenAt: string; lastSeenAt: string; createdAt: string;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/supabase/customers")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else { setError(""); setCustomers(data.data); }
      })
      .catch(() => setError("Failed to load customers"))
      .finally(() => setLoading(false));
  }, []);

  const q = search.toLowerCase();
  const filtered = customers.filter(
    (c) => c.name.toLowerCase().includes(q) || c.phone.includes(search) || c.email.toLowerCase().includes(q) || c.businessName.toLowerCase().includes(q),
  );

  const sum = (k: keyof Customer) => customers.reduce((s, c) => s + (c[k] as number), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        description="Everyone who has booked with a salon on the platform."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              downloadCSV(
                filtered.map((c) => ({
                  Name: c.name, Phone: c.phone, Email: c.email, Salon: c.businessName,
                  "Total Visits": c.totalVisits, Completed: c.completedVisits, Cancelled: c.cancelledVisits,
                  Booked: c.bookedVisits, "Last Service": c.lastService, "Last Visit": c.lastAppointmentDate,
                  "First Seen": new Date(c.firstSeenAt).toLocaleDateString(),
                })),
                "customers",
              )
            }
          >
            <Icon name="download" className="w-3.5 h-3.5" />
            Export
          </Button>
        }
      />

      {error ? (
        <ErrorCard message={error} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total customers" value={customers.length.toLocaleString()} icon="customers" />
            <StatCard label="Total visits" value={sum("totalVisits").toLocaleString()} icon="calendar" accent="primary" />
            <StatCard label="Completed" value={sum("completedVisits").toLocaleString()} icon="check" accent="success" />
            <StatCard label="Cancelled" value={sum("cancelledVisits").toLocaleString()} icon="x" accent="danger" />
          </div>

          <FilterBar search={search} onSearch={setSearch} placeholder="Search by name, phone, email or salon…" />

          <Card className="overflow-hidden">
            {loading ? (
              <CenteredSpinner />
            ) : filtered.length === 0 ? (
              <EmptyState icon="customers" title="No customers found" />
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((c) => (
                  <div key={c.id}>
                    <button
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                      className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-surface-hover transition-colors text-left cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-lg bg-info-soft text-info flex items-center justify-center font-bold text-sm shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium text-fg truncate">{c.name}</h3>
                          {c.totalVisits >= 5 && <Badge tone="warning">Loyal</Badge>}
                        </div>
                        <p className="text-xs text-fg-subtle truncate mt-0.5">{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
                      </div>
                      <div className="hidden sm:flex items-center gap-5 shrink-0 text-center">
                        <Stat value={c.totalVisits} label="Visits" />
                        <Stat value={c.completedVisits} label="Done" tone="text-success" />
                        <Stat value={c.cancelledVisits} label="Cancel" tone="text-danger" />
                      </div>
                      <Link
                        href={`/dashboard/salons/${c.businessId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hidden lg:block text-xs text-primary hover:underline shrink-0"
                      >
                        {c.businessName}
                      </Link>
                      <Icon name="chevron-down" className={cn("w-4 h-4 text-fg-subtle transition-transform shrink-0", expandedId === c.id && "rotate-180")} />
                    </button>
                    {expandedId === c.id && (
                      <div className="px-4 pb-4">
                        <div className="ml-13 bg-surface-2 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <Detail label="Phone" value={c.phone} />
                          <Detail label="Email" value={c.email || "N/A"} />
                          <Detail label="Salon" value={c.businessName} link={`/dashboard/salons/${c.businessId}`} />
                          <Detail label="Last service" value={c.lastService || "N/A"} />
                          <Detail label="Completed" value={String(c.completedVisits)} tone="text-success" />
                          <Detail label="Booked" value={String(c.bookedVisits)} tone="text-primary" />
                          <Detail label="Cancelled" value={String(c.cancelledVisits)} tone="text-danger" />
                          <Detail
                            label="Last visit"
                            value={c.lastAppointmentDate ? new Date(c.lastAppointmentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A"}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ value, label, tone = "text-fg" }: { value: number; label: string; tone?: string }) {
  return (
    <div className="px-1">
      <p className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] text-fg-subtle uppercase tracking-wide">{label}</p>
    </div>
  );
}

function Detail({ label, value, link, tone = "text-fg" }: { label: string; value: string; link?: string; tone?: string }) {
  return (
    <div>
      <p className="text-[10px] text-fg-subtle uppercase tracking-wide">{label}</p>
      {link ? (
        <Link href={link} className="text-sm font-medium text-primary hover:underline">{value}</Link>
      ) : (
        <p className={`text-sm font-medium ${tone}`}>{value}</p>
      )}
    </div>
  );
}
