"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { downloadCSV } from "@/lib/export";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { CenteredSpinner, EmptyState, ErrorCard } from "@/components/ui/feedback";
import { Table, THead, TH, TBody, TR, TD, FilterBar, SegmentedFilter } from "@/components/ui/DataTable";

type Booking = {
  id: string; businessId: string; businessName: string; customerName: string; customerPhone: string;
  customerEmail: string; serviceName: string; categoryName: string; date: string; time: string;
  status: string; amount: number; priceLabel: string; source: string; teamMemberName: string;
  serviceLocation: string; createdAt: string;
};

const STATUS = ["all", "booked", "completed", "cancelled"] as const;

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<(typeof STATUS)[number]>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`/api/supabase/bookings?status=${filter}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else { setError(""); setBookings(data.data); }
      })
      .catch(() => setError("Failed to load bookings"))
      .finally(() => setLoading(false));
  }, [filter]);

  const filtered = bookings.filter((b) => {
    const q = search.toLowerCase();
    return b.customerName.toLowerCase().includes(q) || b.businessName.toLowerCase().includes(q) || b.serviceName.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bookings"
        description="Every appointment booked across the platform."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              downloadCSV(
                filtered.map((b) => ({
                  Salon: b.businessName, Customer: b.customerName, Phone: b.customerPhone, Email: b.customerEmail,
                  Service: b.serviceName, Category: b.categoryName, Date: b.date, Time: b.time,
                  Amount: b.priceLabel, Status: b.status, Source: b.source,
                })),
                "bookings",
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
          <FilterBar search={search} onSearch={setSearch} placeholder="Search customer, salon or service…">
            <SegmentedFilter
              value={filter}
              onChange={(v) => { setLoading(true); setFilter(v); }}
              options={STATUS.map((s) => ({ value: s, label: s }))}
            />
          </FilterBar>

          <Card className="overflow-hidden">
            {loading ? (
              <CenteredSpinner />
            ) : filtered.length === 0 ? (
              <EmptyState icon="bookings" title="No bookings found" />
            ) : (
              <Table>
                <THead>
                  <TH>Salon</TH><TH>Customer</TH><TH>Service</TH><TH>Date &amp; time</TH><TH align="right">Amount</TH><TH>Status</TH>
                </THead>
                <TBody>
                  {filtered.map((b) => (
                    <TR key={b.id}>
                      <TD>
                        <Link href={`/dashboard/salons/${b.businessId}`} className="text-sm font-medium text-primary hover:underline">
                          {b.businessName}
                        </Link>
                      </TD>
                      <TD>
                        <p className="text-sm font-medium text-fg">{b.customerName}</p>
                        <p className="text-xs text-fg-subtle">{b.customerPhone}</p>
                      </TD>
                      <TD>
                        <p className="text-sm text-fg">{b.serviceName}</p>
                        <p className="text-xs text-fg-subtle">{b.categoryName}</p>
                      </TD>
                      <TD className="whitespace-nowrap">
                        {new Date(b.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at {b.time?.slice(0, 5)}
                      </TD>
                      <TD align="right" className="font-semibold text-fg">{b.priceLabel}</TD>
                      <TD><StatusBadge status={b.status} dot /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
