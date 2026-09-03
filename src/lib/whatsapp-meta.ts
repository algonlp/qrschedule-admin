/**
 * Meta WhatsApp Cloud API client — Graph API, used only by the Admin Panel's
 * "Sync from Meta" and "Submit New Version" actions.
 *
 * Credentials come from the environment and are NEVER returned to the browser
 * or written to a log:
 *   WHATSAPP_ACCESS_TOKEN        — permanent system-user token (WhatsApp Manager → API Setup)
 *   WHATSAPP_BUSINESS_ACCOUNT_ID — the WABA id that owns the message templates
 *   WHATSAPP_API_VERSION         — Graph API version, defaults to v21.0
 *   WHATSAPP_TEMPLATE_LANGUAGE   — default template language, defaults to en_US
 *
 * This module does not invent Meta functionality. It calls exactly two
 * documented endpoints:
 *   GET  /{WABA_ID}/message_templates   (list — the source of truth for sync)
 *   POST /{WABA_ID}/message_templates   (create — used for "Submit New Version")
 * Editing an already-APPROVED template is intentionally NOT wired: per the
 * feature spec we submit a new template/version instead.
 */

import type {
  WhatsappTemplateButton,
  WhatsappTemplatePayload,
  WhatsappTemplateVariable,
} from "./whatsapp-templates";

const GRAPH_HOST = "https://graph.facebook.com";

export type MetaConfig = {
  accessToken: string;
  wabaId: string;
  apiVersion: string;
  defaultLanguage: string;
};

export type MetaConfigStatus = {
  configured: boolean;
  /** which required vars are missing — safe to show, contains no secrets */
  missing: string[];
  apiVersion: string;
  /** last 4 chars only, purely so an admin can tell which token is loaded */
  tokenHint: string | null;
  wabaIdHint: string | null;
  /** false => the panel is read-only against Meta (the default) */
  submitAllowed: boolean;
};

const readConfig = (): Partial<MetaConfig> => ({
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim() || undefined,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || undefined,
  apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || "v21.0",
  defaultLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en_US",
});

export const getMetaConfigStatus = (): MetaConfigStatus => {
  const cfg = readConfig();
  const missing: string[] = [];
  if (!cfg.accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!cfg.wabaId) missing.push("WHATSAPP_BUSINESS_ACCOUNT_ID");
  return {
    configured: missing.length === 0,
    missing,
    apiVersion: cfg.apiVersion ?? "v21.0",
    tokenHint: cfg.accessToken ? `…${cfg.accessToken.slice(-4)}` : null,
    wabaIdHint: cfg.wabaId ? `…${cfg.wabaId.slice(-4)}` : null,
    submitAllowed: isMetaSubmitAllowed(),
  };
};

export const requireMetaConfig = (): MetaConfig => {
  const cfg = readConfig();
  const status = getMetaConfigStatus();
  if (!status.configured) {
    throw new MetaConfigError(
      `Meta WhatsApp is not configured. Missing: ${status.missing.join(", ")}`,
    );
  }
  return cfg as MetaConfig;
};

export class MetaConfigError extends Error {
  readonly code = "META_NOT_CONFIGURED";
}

/**
 * Thrown when a Meta WRITE is attempted while the panel is in its default
 * read-only posture. The ONLY Meta write this module can perform is creating a
 * brand-new template ("Submit New Version"); it is disabled unless an operator
 * has explicitly set `WHATSAPP_ALLOW_META_SUBMIT=true` in the environment.
 * Sync, and everything else, is read-only and unaffected.
 */
export class MetaWriteDisabledError extends Error {
  readonly code = "META_WRITE_DISABLED";
  constructor() {
    super(
      "Submitting templates to Meta is disabled. This panel is read-only against Meta by " +
        "default — set WHATSAPP_ALLOW_META_SUBMIT=true to allow creating new templates.",
    );
  }
}

/** True only when an operator has explicitly opted in to the one Meta write path. */
export const isMetaSubmitAllowed = (): boolean =>
  process.env.WHATSAPP_ALLOW_META_SUBMIT?.trim().toLowerCase() === "true";

export class MetaApiError extends Error {
  readonly code = "META_API_ERROR";
  readonly status: number;
  readonly metaCode?: number;
  constructor(message: string, status: number, metaCode?: number) {
    super(message);
    this.status = status;
    this.metaCode = metaCode;
  }
}

/** Strip anything that looks like the access token out of a string. */
const redact = (text: string, token: string | undefined): string => {
  let out = text;
  if (token && token.length > 6) out = out.split(token).join("[redacted]");
  // access_token=... in a URL / body echo
  out = out.replace(/access_token=[^&\s"']+/gi, "access_token=[redacted]");
  return out;
};

type MetaErrorBody = {
  error?: { message?: string; code?: number; type?: string; error_subcode?: number };
};

const parseMetaError = async (res: Response, token: string | undefined): Promise<MetaApiError> => {
  let body: MetaErrorBody = {};
  try {
    body = (await res.json()) as MetaErrorBody;
  } catch {
    /* non-JSON error body */
  }
  const raw = body.error?.message ?? `Meta API request failed (HTTP ${res.status})`;
  return new MetaApiError(redact(raw, token), res.status, body.error?.code);
};

// ---------------------------------------------------------------------------
// Meta message_templates response shapes (only the fields we consume)
// ---------------------------------------------------------------------------
type MetaButton = {
  type: string;
  text?: string;
  url?: string;
  phone_number?: string;
  example?: string[];
};

type MetaComponent = {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS" | string;
  format?: string;
  text?: string;
  buttons?: MetaButton[];
  example?: { header_text?: string[]; body_text?: string[][]; body_text_named_params?: { param_name: string }[] };
};

export type MetaTemplate = {
  id?: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameter_format?: "POSITIONAL" | "NAMED" | string;
  components?: MetaComponent[];
  rejected_reason?: string;
  last_updated_time?: string;
};

type MetaListResponse = {
  data?: MetaTemplate[];
  paging?: { cursors?: { after?: string }; next?: string };
};

// ---------------------------------------------------------------------------
// Normalisation: Meta components  ->  WhatsappTemplatePayload
// ---------------------------------------------------------------------------

/** Pull `{{1}}`, `{{2}}` … or `{{name}}` placeholders out of a body string, in order. */
export const extractVariables = (
  body: string,
  namedParams?: { param_name: string }[],
): WhatsappTemplateVariable[] => {
  const tokens = [...body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      ordered.push(t);
    }
  }
  return ordered.map((token, idx) => {
    const isPositional = /^\d+$/.test(token);
    const named = namedParams?.[idx]?.param_name;
    const key = isPositional ? (named ?? `var${token}`) : token;
    return { position: idx + 1, key, label: named ?? (isPositional ? `Variable ${token}` : token) };
  });
};

const normalizeButton = (b: MetaButton): WhatsappTemplateButton => ({
  type: b.type,
  text: b.text ?? b.type,
  dynamic: b.type === "URL" ? /\{\{\s*\d+\s*\}\}/.test(b.url ?? "") : undefined,
});

export const normalizeMetaTemplate = (tpl: MetaTemplate): WhatsappTemplatePayload => {
  const components = tpl.components ?? [];
  const header = components.find((c) => c.type === "HEADER");
  const bodyC = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttonsC = components.find((c) => c.type === "BUTTONS");

  const body = bodyC?.text ?? "";
  const variables = extractVariables(body, bodyC?.example?.body_text_named_params);

  return {
    name: tpl.name,
    language: tpl.language,
    category: tpl.category,
    headerText: header?.format === "TEXT" ? header?.text : undefined,
    headerFormat: header?.format,
    body,
    footerText: footer?.text,
    buttons: (buttonsC?.buttons ?? []).map(normalizeButton),
    variables,
    metaId: tpl.id ?? null,
    metaUpdatedAt: tpl.last_updated_time ?? null,
    metaRejectedReason: tpl.rejected_reason && tpl.rejected_reason !== "NONE" ? tpl.rejected_reason : null,
    createdVia: "meta-sync",
  };
};

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

const FIELDS = "name,status,category,language,parameter_format,components,rejected_reason,last_updated_time";

/** List every message template on the connected WABA (follows pagination). */
export const fetchMetaMessageTemplates = async (): Promise<MetaTemplate[]> => {
  const cfg = requireMetaConfig();
  const out: MetaTemplate[] = [];
  let url =
    `${GRAPH_HOST}/${cfg.apiVersion}/${cfg.wabaId}/message_templates` +
    `?fields=${FIELDS}&limit=200`;

  // hard page cap so a misbehaving cursor can never loop forever
  for (let page = 0; page < 25 && url; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw await parseMetaError(res, cfg.accessToken);

    const json = (await res.json()) as MetaListResponse;
    for (const tpl of json.data ?? []) out.push(tpl);

    url = json.paging?.next ?? "";
  }
  return out;
};

export type SubmitTemplateInput = {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  components: MetaComponent[];
};

/**
 * Create a NEW template (or a new-name version) in Meta. Returns the new
 * template's id + status (always PENDING right after creation). We never call
 * the edit/delete endpoint on an existing template — the spec requires a new
 * version, and this is the ONLY function in the codebase that writes to Meta.
 *
 * Guarded twice: it throws MetaWriteDisabledError unless
 * `WHATSAPP_ALLOW_META_SUBMIT=true`, and the caller has already refused any
 * name that collides with a template we know locally, so it can only ever
 * ADD a template, never mutate one.
 */
export const submitMetaMessageTemplate = async (
  input: SubmitTemplateInput,
): Promise<{ id: string; status: string; category: string }> => {
  if (!isMetaSubmitAllowed()) throw new MetaWriteDisabledError();
  const cfg = requireMetaConfig();
  const res = await fetch(
    `${GRAPH_HOST}/${cfg.apiVersion}/${cfg.wabaId}/message_templates`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw await parseMetaError(res, cfg.accessToken);
  const json = (await res.json()) as { id?: string; status?: string; category?: string };
  return {
    id: json.id ?? "",
    status: json.status ?? "PENDING",
    category: json.category ?? input.category,
  };
};
