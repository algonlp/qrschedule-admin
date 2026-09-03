import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { MetaApiError, MetaConfigError } from "@/lib/whatsapp-meta";
import { RegistryNotProvisionedError, syncFromMeta } from "@/lib/whatsapp-template-service";

/**
 * POST /api/supabase/whatsapp/templates/sync
 *
 * Pull the connected WABA's message templates and refresh the Meta-owned fields
 * of whatsapp_template_records. Assignment rows are never touched; a template
 * Meta no longer returns is marked NOT_FOUND, never deleted.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await syncFromMeta();

    const summaryParts = [
      `${result.fetched} fetched`,
      `${result.added.length} added`,
      `${result.updated.length} updated`,
      `${result.statusChanges.length} status change(s)`,
    ];
    if (result.markedNotFound.length > 0) {
      summaryParts.push(`${result.markedNotFound.length} marked NOT_FOUND`);
    }

    await writeAuditLog({
      actor: auth.email,
      action: "whatsapp_template.synced",
      entityType: "whatsapp_template_registry",
      entityId: "sync",
      summary: `Synced WhatsApp templates from Meta: ${summaryParts.join(", ")}`,
      after: {
        added: result.added,
        updated: result.updated,
        statusChanges: result.statusChanges,
        markedNotFound: result.markedNotFound,
      },
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    if (error instanceof RegistryNotProvisionedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof MetaConfigError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof MetaApiError) {
      return NextResponse.json(
        { error: `Meta rejected the sync: ${error.message}`, code: error.code },
        { status: 502 },
      );
    }
    console.error("WhatsApp template sync error:", error);
    return NextResponse.json({ error: "Failed to sync WhatsApp templates" }, { status: 500 });
  }
}
