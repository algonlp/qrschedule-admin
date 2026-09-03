"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";

type Booking = {
  id: string;
  businessId: string;
  businessName: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  date: string;
  time: string;
  status: string;
  priceLabel: string;
};

const STATUS_COLORS: Record<string, string> = {
  booked: "bg-primary",
  completed: "bg-success",
  cancelled: "bg-danger",
};

export default function CalendarPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/supabase/bookings")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setBookings(data.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split("T")[0];

  const bookingsByDate = new Map<string, Booking[]>();
  for (const b of bookings) {
    const list = bookingsByDate.get(b.date) || [];
    list.push(b);
    bookingsByDate.set(b.date, list);
  }

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(today);
  };

  const selectedBookings = selectedDate ? bookingsByDate.get(selectedDate) || [] : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Calendar" description="All bookings across the platform, by month." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-surface rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-fg">
              {currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </h2>
            <div className="flex items-center gap-2">
              <button onClick={goToday} className="px-3 py-1.5 text-xs font-medium bg-primary-soft text-primary rounded-lg hover:brightness-95 cursor-pointer">
                Today
              </button>
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-surface-hover cursor-pointer text-fg-muted">
                <svg className="w-5 h-5 text-fg-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-surface-hover cursor-pointer text-fg-muted">
                <svg className="w-5 h-5 text-fg-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="bg-surface-2 text-center py-2 text-xs font-semibold text-fg-muted uppercase">
                {day}
              </div>
            ))}
            {calendarDays.map((day, i) => {
              if (day === null) {
                return <div key={`empty-${i}`} className="bg-surface-2 min-h-[80px]" />;
              }
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayBookings = bookingsByDate.get(dateStr) || [];
              const isToday = dateStr === today;
              const isSelected = dateStr === selectedDate;

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  className={`bg-surface min-h-[80px] p-1.5 text-left cursor-pointer transition-colors relative ${
                    isSelected ? "ring-2 ring-primary z-10" : "hover:bg-surface-hover"
                  }`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                      isToday
                        ? "bg-primary text-primary-fg"
                        : "text-fg-muted"
                    }`}
                  >
                    {day}
                  </span>
                  {dayBookings.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {dayBookings.slice(0, 3).map((b) => (
                        <div
                          key={b.id}
                          className={`${STATUS_COLORS[b.status] || "bg-gray-400"} text-white text-[9px] px-1 py-0.5 rounded truncate leading-tight`}
                        >
                          {b.customerName}
                        </div>
                      ))}
                      {dayBookings.length > 3 && (
                        <p className="text-[9px] text-fg-subtle px-1">+{dayBookings.length - 3} more</p>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="font-semibold text-fg mb-4">
            {selectedDate
              ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : "Select a date"}
          </h3>

          {selectedDate ? (
            selectedBookings.length > 0 ? (
              <div className="space-y-3">
                {selectedBookings.map((b) => (
                  <div key={b.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-fg">{b.customerName}</span>
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full text-white ${STATUS_COLORS[b.status] || "bg-gray-400"}`}
                      >
                        {b.status}
                      </span>
                    </div>
                    <p className="text-xs text-fg-subtle">{b.serviceName} at {b.time?.slice(0, 5)}</p>
                    <div className="flex items-center justify-between mt-2">
                      <Link
                        href={`/dashboard/salons/${b.businessId}`}
                        className="text-xs text-primary hover:underline"
                      >
                        {b.businessName}
                      </Link>
                      <span className="text-xs font-semibold text-fg-muted">{b.priceLabel}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <svg className="w-12 h-12 text-gray-200 dark:text-slate-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm text-fg-subtle">No bookings on this day</p>
              </div>
            )
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-fg-subtle">Click a date to see bookings</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
