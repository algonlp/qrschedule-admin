import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;

    const [bizResult, apptResult, servicesResult, teamResult, customersResult] = await Promise.all([
      supabase.from("businesses").select("*").eq("id", id).single(),
      supabase.from("appointments").select("*").eq("business_id", id).order("created_at", { ascending: false }),
      supabase.from("services").select("*").eq("business_id", id),
      supabase.from("team_members").select("*").eq("business_id", id),
      supabase.from("customer_profiles").select("*").eq("business_id", id),
    ]);

    if (bizResult.error) throw bizResult.error;

    const biz = bizResult.data;
    const appointments = apptResult.data || [];
    const services = servicesResult.data || [];
    const teamMembers = teamResult.data || [];
    const customers = customersResult.data || [];

    const statusCounts: Record<string, number> = {};
    let totalRevenue = 0;
    for (const appt of appointments) {
      statusCounts[appt.status] = (statusCounts[appt.status] || 0) + 1;
      if (appt.status === "completed" && appt.service_amount_value) {
        totalRevenue += appt.service_amount_value;
      }
    }

    const today = new Date().toISOString().split("T")[0];
    const todayAppointments = appointments.filter((a) => a.appointment_date === today);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthlyAppointments = appointments.filter((a) => new Date(a.appointment_date) >= monthStart);

    return NextResponse.json({
      salon: {
        id: biz.id,
        businessName: biz.business_name || "Unnamed Salon",
        email: biz.email,
        phone: biz.mobile_number || biz.business_phone_number || "",
        website: biz.website || "",
        address: biz.venue_address || "",
        profileImage: biz.profile_image_url || "",
        onboardingCompleted: biz.onboarding_completed,
        createdAt: biz.created_at,
      },
      stats: {
        totalAppointments: appointments.length,
        todayAppointments: todayAppointments.length,
        monthlyAppointments: monthlyAppointments.length,
        statusCounts,
        totalRevenue,
        totalServices: services.length,
        totalTeamMembers: teamMembers.length,
        totalCustomers: customers.length,
      },
      recentAppointments: appointments.slice(0, 10).map((a) => ({
        id: a.id,
        customerName: a.customer_name,
        customerPhone: a.customer_phone,
        serviceName: a.service_name,
        categoryName: a.category_name,
        date: a.appointment_date,
        time: a.appointment_time,
        status: a.status,
        amount: a.service_amount_value,
        priceLabel: a.service_price_label,
        createdAt: a.created_at,
      })),
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category_name,
        duration: s.duration_minutes,
        price: s.price_label,
        isActive: s.is_active,
      })),
      teamMembers: teamMembers.map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        phone: t.phone,
        expertise: t.expertise,
        isActive: t.is_active,
      })),
    });
  } catch (error) {
    console.error("Salon detail error:", error);
    return NextResponse.json({ error: "Failed to fetch salon details" }, { status: 500 });
  }
}
