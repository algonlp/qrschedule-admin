import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get("business_id") || null;

    let query = supabase
      .from("customer_profiles")
      .select("*")
      .order("last_seen_at", { ascending: false });

    if (businessId) {
      query = query.eq("business_id", businessId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const businessIds = [...new Set((data || []).map((c) => c.business_id))];
    const { data: businesses } = await supabase
      .from("businesses")
      .select("id, business_name")
      .in("id", businessIds);

    const bizMap = new Map<string, string>();
    for (const b of businesses || []) {
      bizMap.set(b.id, b.business_name || "Unnamed Salon");
    }

    const customers = (data || []).map((c) => ({
      id: c.id,
      businessId: c.business_id,
      businessName: bizMap.get(c.business_id) || "Unknown Salon",
      name: c.customer_name,
      phone: c.customer_phone,
      email: c.customer_email || "",
      totalVisits: c.total_visits,
      bookedVisits: c.booked_visits,
      completedVisits: c.completed_visits,
      cancelledVisits: c.cancelled_visits,
      lastService: c.last_service || "",
      lastAppointmentDate: c.last_appointment_date,
      lastAppointmentTime: c.last_appointment_time,
      firstSeenAt: c.first_seen_at,
      lastSeenAt: c.last_seen_at,
      createdAt: c.created_at,
    }));

    return NextResponse.json({ data: customers, total: customers.length });
  } catch (error) {
    console.error("Customers error:", error);
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
  }
}
