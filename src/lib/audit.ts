import { randomUUID } from "crypto";
import { supabase } from "@/lib/supabase";

/**
 * Append a row to the shared `admin_audit_log` table (created by
 * bookmysalon/supabase/schema.sql; a standalone copy lives in
 * qrschedule_admin/supabase/admin-audit-log.sql).
 *
 * Best-effort: a logging failure (missing table, transient network error) is
 * swallowed so it can never block the mutation the admin actually asked for.
 * The return value tells the caller whether the row was written, for surfacing
 * a soft warning if desired.
 */
export type AuditEntry = {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
};

export async function writeAuditLog(entry: AuditEntry): Promise<{ logged: boolean; error?: string }> {
  try {
    const { error } = await supabase.from("admin_audit_log").insert({
      id: randomUUID(),
      actor: entry.actor,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      summary: entry.summary,
      before_data: entry.before ?? null,
      after_data: entry.after ?? null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.warn("[audit] failed to write audit row:", error.message);
      return { logged: false, error: error.message };
    }

    return { logged: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[audit] failed to write audit row:", message);
    return { logged: false, error: message };
  }
}

/** Shallow diff helper for human-readable audit summaries of plan edits. */
export function describePlanChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  if (!before) return ["created"];
  const changes: string[] = [];
  const scan = (a: Record<string, unknown>, b: Record<string, unknown>, prefix: string) => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const av = a[key];
      const bv = b[key];
      if (key === "updatedAt") continue;
      if (av && bv && typeof av === "object" && typeof bv === "object" && !Array.isArray(av)) {
        scan(av as Record<string, unknown>, bv as Record<string, unknown>, `${prefix}${key}.`);
        continue;
      }
      if (JSON.stringify(av) !== JSON.stringify(bv)) {
        changes.push(`${prefix}${key}: ${JSON.stringify(av)} → ${JSON.stringify(bv)}`);
      }
    }
  };
  scan(before, after, "");
  return changes.length > 0 ? changes : ["no field changes"];
}
