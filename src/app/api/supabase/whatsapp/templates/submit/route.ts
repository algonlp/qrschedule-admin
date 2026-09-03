import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { MetaApiError, MetaConfigError, MetaWriteDisabledError } from "@/lib/whatsapp-meta";
import {
  RegistryNotProvisionedError,
  submitNewVersion,
  TemplateActionError,
} from "@/lib/whatsapp-template-service";

/**
 * POST /api/supabase/whatsapp/templates/submit
 *
 * "Submit New Version" — creates a NEW template in Meta (never edits an
 * approved one). It lands as PENDING and stays unusable by QR Schedule until it
 * is APPROVED by Meta and explicitly assigned + activated here.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const category = String(body.category ?? "").toUpperCase();
  const templateBody = String(body.body ?? "").trim();

  if (!/^[a-z0-9_]+$/.test(name)) {
    return NextResponse.json(
      { error: "Template name must be lower_snake_case (a-z, 0-9, underscore)." },
      { status: 400 },
    );
  }
  if (!["UTILITY", "MARKETING", "AUTHENTICATION"].includes(category)) {
    return NextResponse.json(
      { error: "Category must be UTILITY, MARKETING or AUTHENTICATION." },
      { status: 400 },
    );
  }
  if (!templateBody) {
    return NextResponse.json({ error: "Template body is required." }, { status: 400 });
  }

  try {
    const result = await submitNewVersion({
      name,
      language: body.language ? String(body.language) : undefined,
      category: category as "UTILITY" | "MARKETING" | "AUTHENTICATION",
      body: templateBody,
      headerText: body.headerText ? String(body.headerText) : undefined,
      footerText: body.footerText ? String(body.footerText) : undefined,
      buttons: Array.isArray(body.buttons)
        ? (body.buttons as { type: string; text: string; url?: string }[])
        : undefined,
      bodyExample: Array.isArray(body.bodyExample)
        ? (body.bodyExample as unknown[]).map(String)
        : undefined,
      replacesTemplateName: body.replacesTemplateName ? String(body.replacesTemplateName) : undefined,
      actor: auth.email,
    });

    await writeAuditLog({
      actor: auth.email,
      action: "whatsapp_template.submitted",
      entityType: "whatsapp_template",
      entityId: `${result.templateName}__${result.language}`,
      summary:
        `Submitted new WhatsApp template "${result.templateName}" (${result.language}) to Meta — ` +
        `status ${result.metaStatus}` +
        (body.replacesTemplateName ? `, intended to replace "${body.replacesTemplateName}"` : ""),
      after: result,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    if (error instanceof RegistryNotProvisionedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof MetaWriteDisabledError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    }
    if (error instanceof MetaConfigError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof MetaApiError) {
      return NextResponse.json(
        { error: `Meta rejected the submission: ${error.message}`, code: error.code },
        { status: 502 },
      );
    }
    if (error instanceof TemplateActionError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    console.error("WhatsApp template submit error:", error);
    return NextResponse.json({ error: "Failed to submit template" }, { status: 500 });
  }
}
