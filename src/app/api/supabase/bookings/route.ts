import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "all";
    const businessId = searchParams.get("business_id") || null;

    let query = supabase
      .from("appointments")
      .select("*")
      .order("created_at", { ascending: false });

    if (status !== "all") {
      query = query.eq("status", status);
    }

    if (businessId) {
      query = query.eq("business_id", businessId);
    }

    const { data, error } = await query;

    if (error) throw error;

    const bookings = (data || []).map((appt) => ({
      id: appt.id,
      businessId: appt.business_id,
      businessName: appt.business_name || "Unknown Salon",
      customerName: appt.customer_name,
      customerPhone: appt.customer_phone,
      customerEmail: appt.customer_email,
      serviceName: appt.service_name,
      categoryName: appt.category_name,
      date: appt.appointment_date,
      time: appt.appointment_time,
      status: appt.status,
      amount: appt.service_amount_value,
      priceLabel: appt.service_price_label,
      source: appt.source,
      teamMemberName: appt.team_member_name || "",
      serviceLocation: appt.service_location,
      createdAt: appt.created_at,
    }));

    return NextResponse.json({ data: bookings, total: bookings.length });
  } catch (error) {
    console.error("Bookings error:", error);
    return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
  }
}
