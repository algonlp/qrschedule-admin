import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";

/**
 * "Refresh Provider Rate".
 *
 * Meta does not expose a machine-readable current WhatsApp per-message rate
 * through any supported Graph API endpoint, and web-search results are not an
 * authoritative production source. So there is nothing to fetch: this endpoint
 * deliberately does NOT fabricate a value. It tells the admin to update the
 * rate manually from Meta's official pricing page.
 *
 * When a verified official source becomes available, the fetch/validate/
 * version/audit logic slots in here behind `available: true`.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    available: false,
    message:
      "Official automated rate unavailable. Meta does not publish a machine-readable current WhatsApp rate. " +
      "Please update the provider rate manually from Meta's official pricing page.",
    officialPricingUrl: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing",
  });
}
