export function extractSalonName(meta?: Record<string, string> | null): string | null {
  if (!meta) return null;
  return meta.salon_name || meta.businessName || meta.business_name || null;
}

export function parseSalonFromDescription(description?: string | null): string | null {
  if (!description) return null;
  const dashMatch = description.match(/—\s*(.+)$/);
  if (dashMatch) return dashMatch[1].trim();
  const hyphenMatch = description.match(/-\s*(.+)$/);
  if (hyphenMatch) return hyphenMatch[1].trim();
  return null;
}
