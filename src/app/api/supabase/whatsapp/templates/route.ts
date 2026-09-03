import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getMetaConfigStatus } from "@/lib/whatsapp-meta";
import { listTemplates } from "@/lib/whatsapp-template-service";

/**
 * GET /api/supabase/whatsapp/templates
 *
 * The single read for the WhatsApp Templates page: every Meta template we know
 * about (joined to its QR Schedule assignments, compatibility and usage), the
 * list of messaging purposes with their currently-resolved template, and
 * whether Meta sync is even possible in this environment.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { templates, plans, salons, matrices, provisioned } = await listTemplates();
    return NextResponse.json({
      data: { templates, plans, salons, matrices, provisioned, meta: getMetaConfigStatus() },
    });
  } catch (error) {
    console.error("WhatsApp templates load error:", error);
    return NextResponse.json(
      { error: "Failed to load WhatsApp templates" },
      { status: 500 },
    );
  }
}
