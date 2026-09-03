import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const [apptResult, bizResult] = await Promise.all([
      supabase.from("appointments").select("*"),
      supabase.from("businesses").select("id, business_name, created_at, onboarding_completed"),
    ]);

    if (apptResult.error) throw apptResult.error;
    if (bizResult.error) throw bizResult.error;

    const appointments = apptResult.data || [];
    const businesses = bizResult.data || [];

    const monthlyRevenue: Record<string, number> = {};
    const monthlyBookings: Record<string, number> = {};
    const dailyBookings: Record<string, number> = {};
    const statusDistribution: Record<string, number> = {};
    const salonBookings: Record<string, { name: string; count: number; revenue: number }> = {};

    for (const appt of appointments) {
      const month = appt.appointment_date?.slice(0, 7);
      const day = appt.appointment_date;

      if (month) {
        monthlyBookings[month] = (monthlyBookings[month] || 0) + 1;
        if (appt.status === "completed" && appt.service_amount_value) {
          monthlyRevenue[month] = (monthlyRevenue[month] || 0) + appt.service_amount_value;
        }
      }

      if (day) {
        dailyBookings[day] = (dailyBookings[day] || 0) + 1;
      }

      statusDistribution[appt.status] = (statusDistribution[appt.status] || 0) + 1;

      const bizId = appt.business_id;
      if (!salonBookings[bizId]) {
        salonBookings[bizId] = { name: appt.business_name || "Unknown", count: 0, revenue: 0 };
      }
      salonBookings[bizId].count++;
      if (appt.status === "completed" && appt.service_amount_value) {
        salonBookings[bizId].revenue += appt.service_amount_value;
      }
    }

    const monthlyGrowth: Record<string, number> = {};
    for (const biz of businesses) {
      const month = biz.created_at?.slice(0, 7);
      if (month) {
        monthlyGrowth[month] = (monthlyGrowth[month] || 0) + 1;
      }
    }

    const sortedMonths = Object.keys({ ...monthlyRevenue, ...monthlyBookings, ...monthlyGrowth }).sort();

    const revenueChart = sortedMonths.map((m) => ({
      month: m,
      label: new Date(m + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      revenue: monthlyRevenue[m] || 0,
      bookings: monthlyBookings[m] || 0,
      newSalons: monthlyGrowth[m] || 0,
    }));

    const last30Days: { date: string; label: string; bookings: number }[] = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      last30Days.push({
        date: dateStr,
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        bookings: dailyBookings[dateStr] || 0,
      });
    }

    const topSalons = Object.entries(salonBookings)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const statusData = Object.entries(statusDistribution).map(([name, value]) => ({ name, value }));

    return NextResponse.json({
      revenueChart,
      dailyBookings: last30Days,
      topSalons,
      statusDistribution: statusData,
      totals: {
        totalSalons: businesses.length,
        activeSalons: businesses.filter((b) => b.onboarding_completed).length,
        totalAppointments: appointments.length,
        totalRevenue: appointments
          .filter((a) => a.status === "completed" && a.service_amount_value)
          .reduce((sum, a) => sum + a.service_amount_value, 0),
      },
    });
  } catch (error) {
    console.error("Analytics error:", error);
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}
