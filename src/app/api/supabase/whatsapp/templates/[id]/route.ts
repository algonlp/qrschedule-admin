import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import {
  assignTemplate,
  RegistryNotProvisionedError,
  setAssignmentActive,
  setTemplateAdminMeta,
  stopTemplate,
  TemplateActionError,
} from "@/lib/whatsapp-template-service";

/**
 * PATCH /api/supabase/whatsapp/templates/:id
 *
 * One mutation entry point, dispatched on `action`:
 *   assign      { purpose, plan?, businessId?, language?, activate? }  bind template
 *   activate    { purpose, plan?, businessId?, language? }             turn a binding ON
 *   deactivate  { purpose, plan?, businessId?, language? }             turn a binding OFF
 *   stop        {}                                        emergency stop everywhere
 *   notes       { adminNotes?, archived? }                internal metadata only
 *
 * `plan` defaults to '*' (the global/any-plan assignment). `businessId` scopes
 * the binding to a single salon and takes precedence over plan/global for it;
 * a salon binding is flat, so `plan` is ignored when `businessId` is set.
 * `:id` is the whatsapp_template_records id (`<name>__<language>`).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "assign": {
        const result = await assignTemplate({
          templateId: id,
          purpose: String(body.purpose ?? ""),
          plan: body.plan ? String(body.plan) : undefined,
          businessId: body.businessId ? String(body.businessId) : undefined,
          language: body.language ? String(body.language) : undefined,
          activate: Boolean(body.activate),
          actor: auth.email,
        });
        const scope = result.businessId !== "*" ? `salon ${result.salonName ?? result.businessId}` : `plan ${result.plan}`;
        await writeAuditLog({
          actor: auth.email,
          action: "whatsapp_template.assigned",
          entityType: "whatsapp_template_assignment",
          entityId: `${result.purpose}__${result.plan}__${result.businessId}__${result.language}`,
          summary:
            `Assigned "${result.templateName}" to ${result.purpose} / ${scope} / ${result.language}` +
            (result.previousTemplateName ? ` (was "${result.previousTemplateName}")` : "") +
            (result.isActive ? " and activated" : " (inactive)"),
          before: { templateName: result.previousTemplateName },
          after: {
            templateName: result.templateName,
            plan: result.plan,
            businessId: result.businessId,
            isActive: result.isActive,
          },
        });
        return NextResponse.json({ data: result });
      }

      case "activate":
      case "deactivate": {
        const active = action === "activate";
        const result = await setAssignmentActive({
          purpose: String(body.purpose ?? ""),
          plan: body.plan ? String(body.plan) : undefined,
          businessId: body.businessId ? String(body.businessId) : undefined,
          language: body.language ? String(body.language) : undefined,
          active,
          actor: auth.email,
        });
        const scope = result.businessId !== "*" ? `salon ${result.businessId}` : `plan ${result.plan}`;
        await writeAuditLog({
          actor: auth.email,
          action: `whatsapp_template.${action}d`,
          entityType: "whatsapp_template_assignment",
          entityId: `${result.purpose}__${result.plan}__${result.businessId}__${result.language}`,
          summary:
            `${active ? "Activated" : "Deactivated"} "${result.templateName}" for ` +
            `${result.purpose} / ${scope} / ${result.language}`,
          after: {
            templateName: result.templateName,
            plan: result.plan,
            businessId: result.businessId,
            isActive: result.isActive,
          },
        });
        return NextResponse.json({ data: result });
      }

      case "stop": {
        const result = await stopTemplate({ templateId: id, actor: auth.email });
        await writeAuditLog({
          actor: auth.email,
          action: "whatsapp_template.stopped",
          entityType: "whatsapp_template",
          entityId: id,
          summary:
            `Emergency-stopped "${result.templateName}" — deactivated ${result.affectedPurposes.length} ` +
            `assignment(s): ${result.affectedPurposes.map((p) => `${p.purpose}/${p.plan}`).join(", ") || "none"}`,
          after: { affectedPurposes: result.affectedPurposes },
        });
        return NextResponse.json({ data: result });
      }

      case "notes": {
        await setTemplateAdminMeta({
          templateId: id,
          adminNotes: body.adminNotes !== undefined ? String(body.adminNotes) : undefined,
          archived: body.archived !== undefined ? Boolean(body.archived) : undefined,
        });
        await writeAuditLog({
          actor: auth.email,
          action: "whatsapp_template.notes_updated",
          entityType: "whatsapp_template",
          entityId: id,
          summary: `Updated internal notes/metadata for ${id}`,
          after: {
            adminNotes: body.adminNotes,
            archived: body.archived,
          },
        });
        return NextResponse.json({ data: { ok: true } });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action "${action}"` },
          { status: 400 },
        );
    }
  } catch (error) {
    if (error instanceof RegistryNotProvisionedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof TemplateActionError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    console.error(`WhatsApp template ${action} error:`, error);
    return NextResponse.json({ error: `Failed to ${action || "update"} template` }, { status: 500 });
  }
}
