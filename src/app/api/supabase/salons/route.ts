import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { data: businesses, error: bizError } = await supabase
      .from("businesses")
      .select("*")
      .order("created_at", { ascending: false });

    if (bizError) throw bizError;

    const { data: appointments, error: apptError } = await supabase
      .from("appointments")
      .select("business_id, status");

    if (apptError) throw apptError;

    const apptMap = new Map<string, { total: number; booked: number; completed: number; cancelled: number }>();
    for (const appt of appointments || []) {
      const stats = apptMap.get(appt.business_id) || { total: 0, booked: 0, completed: 0, cancelled: 0 };
      stats.total++;
      if (appt.status === "booked") stats.booked++;
      else if (appt.status === "completed") stats.completed++;
      else if (appt.status === "cancelled") stats.cancelled++;
      apptMap.set(appt.business_id, stats);
    }

    const salons = (businesses || []).map((biz) => {
      const stats = apptMap.get(biz.id) || { total: 0, booked: 0, completed: 0, cancelled: 0 };
      return {
        id: biz.id,
        businessName: biz.business_name || "Unnamed Salon",
        email: biz.email,
        phone: biz.mobile_number || biz.business_phone_number || "",
        website: biz.website || "",
        address: biz.venue_address || "",
        profileImage: biz.profile_image_url || "",
        onboardingCompleted: biz.onboarding_completed,
        createdAt: biz.created_at,
        appointments: stats,
      };
    });

    return NextResponse.json({ data: salons, total: salons.length });
  } catch (error) {
    console.error("Salons error:", error);
    return NextResponse.json({ error: "Failed to fetch salons" }, { status: 500 });
  }
}
