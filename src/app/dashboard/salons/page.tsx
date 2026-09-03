"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { downloadCSV } from "@/lib/export";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { CenteredSpinner, EmptyState, ErrorCard } from "@/components/ui/feedback";
import { FilterBar, SegmentedFilter } from "@/components/ui/DataTable";

type Salon = {
  id: string;
  businessName: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  profileImage: string;
  onboardingCompleted: boolean;
  createdAt: string;
  appointments: { total: number; booked: number; completed: number; cancelled: number };
};

export default function SalonsPage() {
  const [salons, setSalons] = useState<Salon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "incomplete">("all");

  function load() {
    fetch("/api/supabase/salons")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else { setError(""); setSalons(data.data); }
      })
      .catch(() => setError("Failed to load salons"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const filtered = salons.filter((s) => {
    const q = search.toLowerCase();
    const matchesSearch =
      s.businessName.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || s.phone.includes(search);
    const matchesFilter =
      filter === "all" ||
      (filter === "active" && s.onboardingCompleted) ||
      (filter === "incomplete" && !s.onboardingCompleted);
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Salons"
        description={`${salons.length} businesses on the platform.`}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              downloadCSV(
                filtered.map((s) => ({
                  Name: s.businessName, Email: s.email, Phone: s.phone, Address: s.address,
                  Status: s.onboardingCompleted ? "Active" : "Setup",
                  "Total Appointments": s.appointments.total, Completed: s.appointments.completed,
                  Booked: s.appointments.booked, Cancelled: s.appointments.cancelled,
                  "Joined Date": new Date(s.createdAt).toLocaleDateString(),
                })),
                "salons",
              )
            }
          >
            <Icon name="download" className="w-3.5 h-3.5" />
            Export
          </Button>
        }
      />

      {error ? (
        <ErrorCard message={error} onRetry={() => { setLoading(true); load(); }} />
      ) : (
        <>
          <FilterBar search={search} onSearch={setSearch} placeholder="Search by name, email or phone…">
            <SegmentedFilter
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: `All (${salons.length})` },
                { value: "active", label: "Active" },
                { value: "incomplete", label: "Setup" },
              ]}
            />
          </FilterBar>

          <Card className="overflow-hidden">
            {loading ? (
              <CenteredSpinner />
            ) : filtered.length === 0 ? (
              <EmptyState icon="salons" title="No salons found" description="Try a different search or filter." />
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((salon) => (
                  <Link
                    key={salon.id}
                    href={`/dashboard/salons/${salon.id}`}
                    className="flex items-center gap-4 px-4 py-3.5 hover:bg-surface-hover transition-colors group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center font-bold text-sm shrink-0">
                      {salon.businessName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-fg truncate group-hover:text-primary transition-colors">{salon.businessName}</h3>
                        <Badge tone={salon.onboardingCompleted ? "success" : "warning"}>{salon.onboardingCompleted ? "Active" : "Setup"}</Badge>
                      </div>
                      <p className="text-xs text-fg-subtle truncate mt-0.5">
                        {salon.email}
                        {salon.phone ? ` · ${salon.phone}` : ""}
                        {salon.address ? ` · ${salon.address}` : ""}
                      </p>
                    </div>
                    <div className="hidden sm:flex items-center gap-5 shrink-0 text-center">
                      <Stat value={salon.appointments.total} label="Total" />
                      <Stat value={salon.appointments.completed} label="Done" tone="text-success" />
                      <Stat value={salon.appointments.booked} label="Booked" tone="text-primary" />
                    </div>
                    <span className="text-xs text-fg-subtle hidden lg:block shrink-0">
                      {new Date(salon.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <Icon name="chevron-right" className="w-4 h-4 text-fg-subtle group-hover:text-primary transition-colors shrink-0" />
                  </Link>
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
