"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type SalonDetail = {
  salon: {
    id: string;
    businessName: string;
    email: string;
    phone: string;
    website: string;
    address: string;
    profileImage: string;
    onboardingCompleted: boolean;
    createdAt: string;
  };
  stats: {
    totalAppointments: number;
    todayAppointments: number;
    monthlyAppointments: number;
    statusCounts: Record<string, number>;
    totalRevenue: number;
    totalServices: number;
    totalTeamMembers: number;
    totalCustomers: number;
  };
  recentAppointments: {
    id: string;
    customerName: string;
    customerPhone: string;
    serviceName: string;
    categoryName: string;
    date: string;
    time: string;
    status: string;
    amount: number;
    priceLabel: string;
    createdAt: string;
  }[];
  services: {
    id: string;
    name: string;
    category: string;
    duration: number;
    price: string;
    isActive: boolean;
  }[];
  teamMembers: {
    id: string;
    name: string;
    role: string;
    phone: string;
    expertise: string;
    isActive: boolean;
  }[];
};

export default function SalonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SalonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/supabase/salons/${id}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.error) setError(result.error);
        else setData(result);
      })
      .catch(() => setError("Failed to load salon details"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
        <p className="text-red-700 dark:text-red-400 font-medium">{error || "Salon not found"}</p>
        <Link href="/dashboard/salons" className="text-primary hover:underline text-sm mt-2 inline-block">
          Back to Salons
        </Link>
      </div>
    );
  }

  const { salon, stats, recentAppointments, services, teamMembers } = data;

  const statCards = [
    { title: "Total Appointments", value: stats.totalAppointments },
    { title: "Today", value: stats.todayAppointments },
    { title: "This Month", value: stats.monthlyAppointments },
    { title: "Completed", value: stats.statusCounts["completed"] || 0 },
    { title: "Booked", value: stats.statusCounts["booked"] || 0 },
    { title: "Cancelled", value: stats.statusCounts["cancelled"] || 0 },
    { title: "Revenue", value: `Rs ${stats.totalRevenue.toLocaleString()}` },
    { title: "Customers", value: stats.totalCustomers },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/salons"
        className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-primary transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Salons
      </Link>

      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-primary-fg font-bold text-xl flex-shrink-0">
            {salon.businessName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-fg">{salon.businessName}</h2>
              <span
                className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${
                  salon.onboardingCompleted
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}
              >
                {salon.onboardingCompleted ? "Active" : "Setup Incomplete"}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-fg-subtle">
              <span>{salon.email}</span>
              {salon.phone && <span>{salon.phone}</span>}
              {salon.address && <span>{salon.address}</span>}
            </div>
            <p className="text-xs text-fg-subtle mt-1">
              Joined {new Date(salon.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((card) => (
          <div key={card.title} className="bg-surface rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-fg-muted">{card.title}</p>
            <p className="text-2xl font-bold text-fg mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-surface rounded-xl border border-border">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-fg">Recent Appointments</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="text-left text-xs font-medium text-fg-muted uppercase px-5 py-3">Customer</th>
                <th className="text-left text-xs font-medium text-fg-muted uppercase px-5 py-3">Service</th>
                <th className="text-left text-xs font-medium text-fg-muted uppercase px-5 py-3">Date & Time</th>
                <th className="text-left text-xs font-medium text-fg-muted uppercase px-5 py-3">Amount</th>
                <th className="text-left text-xs font-medium text-fg-muted uppercase px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentAppointments.map((appt) => (
                <tr key={appt.id} className="border-b border-gray-50 dark:border-slate-700 hover:bg-surface-hover">
                  <td className="px-5 py-3">
                    <p className="text-sm font-semibold text-fg">{appt.customerName}</p>
                    <p className="text-xs text-fg-subtle">{appt.customerPhone}</p>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-sm text-gray-900 dark:text-gray-200">{appt.serviceName}</p>
                    <p className="text-xs text-fg-subtle">{appt.categoryName}</p>
                  </td>
                  <td className="px-5 py-3 text-sm text-fg-muted">
                    {new Date(appt.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {" at "}
                    {appt.time?.slice(0, 5)}
                  </td>
                  <td className="px-5 py-3 text-sm font-semibold text-fg">{appt.priceLabel}</td>
                  <td className="px-5 py-3">
                    <AppointmentStatusBadge status={appt.status} />
                  </td>
                </tr>
              ))}
              {recentAppointments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-fg-subtle">
                    No appointments yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface rounded-xl border border-border">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-fg">Services ({services.length})</h3>
          </div>
          <div className="divide-y divide-border">
            {services.map((service) => (
              <div key={service.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-fg">{service.name}</p>
                  <p className="text-xs text-fg-subtle">
                    {service.category} &middot; {service.duration} min
                  </p>
                </div>
                <span className="text-sm font-semibold text-fg-muted">{service.price}</span>
              </div>
            ))}
            {services.length === 0 && (
              <div className="px-5 py-6 text-center text-fg-subtle text-sm">No services added</div>
            )}
          </div>
        </div>

        <div className="bg-surface rounded-xl border border-border">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-fg">Team Members ({teamMembers.length})</h3>
          </div>
          <div className="divide-y divide-border">
            {teamMembers.map((member) => (
              <div key={member.id} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-fg-muted font-semibold text-xs">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-fg">{member.name}</p>
                    <p className="text-xs text-fg-subtle">{member.role}</p>
                  </div>
                </div>
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                    member.isActive
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-gray-50 text-fg-subtle border-gray-200"
                  }`}
                >
                  {member.isActive ? "Active" : "Inactive"}
                </span>
              </div>
            ))}
            {teamMembers.length === 0 && (
              <div className="px-5 py-6 text-center text-fg-subtle text-sm">No team members</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppointmentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    booked: "bg-primary-soft text-primary border-transparent",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    cancelled: "bg-red-50 text-red-700 border-red-200",
    "no-show": "bg-gray-50 text-gray-600 border-gray-200",
  };

  return (
    <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${styles[status] || styles.booked}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
