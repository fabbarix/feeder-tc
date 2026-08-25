/**
 * Recipe import — debugging surfaces layered underneath the plain-language
 * headline (`error-messages.ts`), per the owner's 2026-08-25 report: "There
 * is no way to know what's happening with a recipe reading." A household
 * self-hosting the configured address needs to see the actual traffic when
 * it fails; the cook using someone else's address never has to look.
 *
 * Two jobs, both pure (no I/O, no React, no fetch — `client.ts` calls these
 * to build/attach a diagnostic, `RecipeImport.tsx` calls these to render and
 * persist one):
 *
 *  1. Build a `RecipeImportDiagnostic` for one request — a redacted request
 *     summary, the HTTP outcome, a truncated response body, elapsed time,
 *     and (on failure) which of the six previously-indistinguishable causes
 *     this was, plus structured validation detail when relevant.
 *  2. A small, capped `localStorage` history of the last few diagnostics —
 *     `readImportHistory`/`recordImportAttempt`/`clearImportHistory` — so a
 *     failure can be inspected after the fact, not only in the instant it
 *     happens.
 *
 * Two things this module exists specifically to keep OUT of any diagnostic,
 * under every code path, no exceptions (owner's explicit "must not go in
 * it"):
 *
 *  - **The API key.** `redactHeaders` strips any `Authorization` header
 *    value before it is ever attached to a diagnostic object; nothing else
 *    in `client.ts` copies the raw header map into a diagnostic.
 *  - **Raw base64 image payloads.** `summarizeRequestBody` walks a request
 *    body and replaces every `data:` URL (an image part, from
 *    `photo-encode.ts`) with a small summary object — that it is an image,
 *    its approximate size, and its pixel dimensions when they can be read
 *    straight out of the JPEG's own SOF marker — never the payload itself.
 */

export type ImportProgressStage = "sending" | "waiting" | "reading" | "checking";

/** Cook-facing copy for each progress stage — plain words, shown with a running elapsed time next to them (`RecipeImport.tsx`). */
export const IMPORT_PROGRESS_LABEL: Readonly<Record<ImportProgressStage, string>> = {
  sending: "Sending your recipe…",
  waiting: "Waiting for a reply…",
  reading: "Reading the reply…",
  checking: "Checking the ingredients…",
};

/**
 * The six previously-collapsed causes of the client's one identical
 * "couldn't make sense of what came back" message, now told apart —
 * `client.ts`'s comment above `RecipeImportError` maps each throw site to
 * exactly one of these. A non-2xx status that isn't already its own headline
 * reason (unauthorized/rate-limited/tool-unsupported) also lands here as
 * `bad-status`, since that bucket was exactly as indistinguishable as the
 * other five before this module existed.
 */
export type ImportFailureCause =
  | "bad-status"
  | "unparseable-body"
  | "missing-content"
  | "content-not-json"
  | "schema-mismatch"
  | "no-ingredients";

/** Plain-but-specific, for the diagnostic panel (not the headline) — CLAUDE.md's jargon rule is scoped to the headline only; this is exactly the vocabulary someone debugging their own server needs. */
export const IMPORT_FAILURE_CAUSE_LABEL: Readonly<Record<ImportFailureCause, string>> = {
  "bad-status": "The address responded, but with an unexpected status.",
  "unparseable-body": "The response body wasn't valid JSON at all.",
  "missing-content": "The response was valid JSON, but had nowhere the reply's text could be found.",
  "content-not-json": "The reply's text wasn't valid JSON — it read like prose instead of the structured reply that was asked for.",
  "schema-mismatch": "The reply was valid JSON, but didn't match the shape that was asked for.",
  "no-ingredients": "The reply was valid and shaped correctly, but listed no ingredients at all.",
};

export interface ImportValidationDetail {
  readonly field?: string;
  readonly expected?: string;
  readonly received?: string;
}

/**
 * Link imports only — one `web_search_call` the reply reported, reduced to
 * diagnostic-panel vocabulary (`./source-verification.ts`'s own doc comment:
 * "so a puzzling import can be explained afterwards"). Never redacted —
 * these are page addresses and search queries, not credentials.
 */
export interface ImportToolActionSummary {
  readonly type: string;
  readonly query?: string;
  readonly sources?: readonly string[];
}

export interface ImportRequestSummary {
  readonly url: string;
  readonly method: string;
  readonly model: string;
  /** Never contains the real `Authorization` value — see `redactHeaders`. */
  readonly headers: Readonly<Record<string, string>>;
  /** JSON-safe: every image part replaced by `summarizeImagePart`'s output, long text truncated by `truncateForDiagnostic`. */
  readonly body: unknown;
}

export interface RecipeImportDiagnostic {
  readonly outcome: "ok" | "error";
  readonly startedAt: string;
  readonly elapsedMs: number;
  readonly request: ImportRequestSummary;
  readonly httpStatus?: number;
  readonly httpStatusText?: string;
  /** Truncated with `truncateForDiagnostic` — never the raw unbounded body. */
  readonly responseBodyPreview?: string;
  readonly cause?: ImportFailureCause;
  readonly validation?: ImportValidationDetail;
  /** Link imports only — every `web_search_call` the reply reported, in order (`./source-verification.ts`). Absent (not empty) when the reply reported none at all, or for the text/photo paths, which never carry this. */
  readonly toolActions?: readonly ImportToolActionSummary[];
  /** Link imports only — every `url_citation` URL the reply's own annotations named, in order. This is what `sourceVerification` on the resulting draft is computed from — recorded here too so a puzzling import can be explained afterwards from the diagnostic panel alone, without re-deriving it. */
  readonly citedUrls?: readonly string[];
}

const REDACTED = "[redacted]";

/** Strips any header that could carry a credential — matched by name, not by guessing at value shape, so a password sent under a differently-cased or custom header name is still caught by the one header this feature ever sets (`Authorization`). */
export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = /author|apikey|api-key|secret|password/i.test(key) ? REDACTED : value;
  }
  return out;
}

const MAX_RESPONSE_BODY_CHARS = 4000;
const TRUNCATION_MARKER = "\n…[truncated — showing the first {n} characters]";

/** Truncates long text with an explicit marker rather than silently cutting it off (owner's requirement) — used for response bodies and any long string field a request/response body summary carries. */
export function truncateForDiagnostic(text: string, maxChars = MAX_RESPONSE_BODY_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + TRUNCATION_MARKER.replace("{n}", String(maxChars));
}

export interface ImagePartSummary {
  readonly type: "image";
  readonly approxKB: number;
  readonly dimensions?: string;
}

function base64Length(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  return commaIndex >= 0 ? dataUrl.length - commaIndex - 1 : dataUrl.length;
}

/**
 * Reads a JPEG's own width/height straight out of its SOF marker — no
 * canvas, no `Image` element, just the bytes already sitting in the data
 * URL. Returns `undefined` on anything that isn't a well-formed baseline/
 * progressive JPEG (a truncated sample, a non-JPEG data URL) rather than
 * throwing — "dimensions if known" (owner's phrasing), never a hard
 * requirement.
 */
export function readJpegDimensionsFromBase64(base64: string): { readonly width: number; readonly height: number } | undefined {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;

    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segmentLength = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) {
        if (offset + 9 > bytes.length) return undefined;
        const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
        const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
        return width > 0 && height > 0 ? { width, height } : undefined;
      }
      offset += 2 + segmentLength;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Summarises one `data:` image URL for a diagnostic — never the payload. */
export function summarizeImagePart(dataUrl: string): ImagePartSummary {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const approxBytes = Math.round(base64Length(dataUrl) * 0.75);
  const dims = readJpegDimensionsFromBase64(b64);
  return {
    type: "image",
    approxKB: Math.max(1, Math.round(approxBytes / 1024)),
    ...(dims ? { dimensions: `${dims.width}×${dims.height}px` } : {}),
  };
}

const DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;

/**
 * Deep-walks a request body (already-`JSON.stringify`-safe: plain objects,
 * arrays, strings, numbers, booleans, null) replacing every `data:image/...`
 * string with `summarizeImagePart`'s output and truncating any other long
 * string. Structure-agnostic on purpose — it does not need to know whether
 * it's looking at Chat Completions' `image_url.url` or some other shape a
 * future path introduces; anything that looks like an embedded image gets
 * summarised, anywhere it appears.
 */
export function summarizeRequestBody(body: unknown, maxStringChars = 2000): unknown {
  if (typeof body === "string") {
    return DATA_URL_PATTERN.test(body) ? summarizeImagePart(body) : truncateForDiagnostic(body, maxStringChars);
  }
  if (Array.isArray(body)) {
    return body.map((item) => summarizeRequestBody(item, maxStringChars));
  }
  if (typeof body === "object" && body !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      out[key] = summarizeRequestBody(value, maxStringChars);
    }
    return out;
  }
  return body;
}

/** Assembles the final diagnostic once a request has settled (success or failure) — the one place `elapsedMs`/`startedAt` get computed, so `client.ts` only ever has to pass through the timestamp it captured when the request began. */
export function finalizeDiagnostic(input: {
  readonly outcome: "ok" | "error";
  readonly startedAtMs: number;
  readonly request: ImportRequestSummary;
  readonly httpStatus?: number;
  readonly httpStatusText?: string;
  readonly responseBodyText?: string;
  readonly cause?: ImportFailureCause;
  readonly validation?: ImportValidationDetail;
  readonly toolActions?: readonly ImportToolActionSummary[];
  readonly citedUrls?: readonly string[];
  readonly now?: number;
}): RecipeImportDiagnostic {
  const now = input.now ?? Date.now();
  return {
    outcome: input.outcome,
    startedAt: new Date(input.startedAtMs).toISOString(),
    elapsedMs: Math.max(0, now - input.startedAtMs),
    request: input.request,
    ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
    ...(input.httpStatusText !== undefined && input.httpStatusText !== "" ? { httpStatusText: input.httpStatusText } : {}),
    ...(input.responseBodyText !== undefined ? { responseBodyPreview: truncateForDiagnostic(input.responseBodyText) } : {}),
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
    ...(input.validation !== undefined ? { validation: input.validation } : {}),
    ...(input.toolActions !== undefined && input.toolActions.length > 0 ? { toolActions: input.toolActions } : {}),
    ...(input.citedUrls !== undefined && input.citedUrls.length > 0 ? { citedUrls: input.citedUrls } : {}),
  };
}

/**
 * Renders a diagnostic as plain text for the "copy to clipboard" affordance
 * — deliberately flat/greppable rather than JSON, since the person reading
 * this pasted it into a chat or an issue, not a JSON viewer. Never touches
 * anything not already on the diagnostic, so the redaction/summarisation
 * guarantees above hold transitively: if the key or an image payload isn't
 * on the object, it cannot appear in this text either.
 */
export function formatDiagnosticForClipboard(diagnostic: RecipeImportDiagnostic): string {
  const lines: string[] = [];
  lines.push(`Feeder recipe import — ${diagnostic.outcome === "ok" ? "succeeded" : "failed"}`);
  lines.push(`Started: ${diagnostic.startedAt}`);
  lines.push(`Elapsed: ${(diagnostic.elapsedMs / 1000).toFixed(1)}s`);
  lines.push(`Address: ${diagnostic.request.method} ${diagnostic.request.url}`);
  lines.push(`Model: ${diagnostic.request.model}`);
  if (diagnostic.httpStatus !== undefined) {
    lines.push(`Status: ${diagnostic.httpStatus}${diagnostic.httpStatusText ? ` ${diagnostic.httpStatusText}` : ""}`);
  }
  if (diagnostic.cause !== undefined) {
    lines.push(`Cause: ${IMPORT_FAILURE_CAUSE_LABEL[diagnostic.cause]}`);
  }
  if (diagnostic.validation) {
    const { field, expected, received } = diagnostic.validation;
    if (field !== undefined) lines.push(`Field: ${field}`);
    if (expected !== undefined) lines.push(`Expected: ${expected}`);
    if (received !== undefined) lines.push(`Received: ${received}`);
  }
  if (diagnostic.toolActions && diagnostic.toolActions.length > 0) {
    lines.push("Tool actions:");
    for (const action of diagnostic.toolActions) {
      const queryPart = action.query !== undefined ? ` — query: ${action.query}` : "";
      const sourcesPart = action.sources !== undefined ? ` — sources: ${action.sources.join(", ")}` : "";
      lines.push(`- ${action.type}${queryPart}${sourcesPart}`);
    }
  }
  if (diagnostic.citedUrls && diagnostic.citedUrls.length > 0) {
    lines.push(`Cited URL(s): ${diagnostic.citedUrls.join(", ")}`);
  }
  lines.push("");
  lines.push("Request headers:");
  lines.push(JSON.stringify(redactHeaders(diagnostic.request.headers), null, 2));
  lines.push("");
  lines.push("Request body:");
  lines.push(JSON.stringify(diagnostic.request.body, null, 2));
  if (diagnostic.responseBodyPreview !== undefined) {
    lines.push("");
    lines.push("Response body:");
    lines.push(diagnostic.responseBodyPreview);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// A small, capped history of recent attempts — localStorage, same trust
// boundary as `settings.ts`/`photo-queue.ts`. Diagnostics only, never the
// photos themselves (they're already summarised out of `request.body` by
// the time one reaches here, so there's nothing further to strip).
// ---------------------------------------------------------------------------

const HISTORY_KEY = "feeder.recipeImport.diagnosticHistory.v1";

/** Newest-first cap — "small" (owner's word): five recent attempts is enough to catch an intermittent failure without `localStorage` quietly growing forever. */
export const MAX_IMPORT_HISTORY = 5;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Lenient — a corrupted or hand-edited entry is dropped, not thrown on (same rule every other localStorage reader in `src/import` already follows). */
function isDiagnostic(value: unknown): value is RecipeImportDiagnostic {
  if (!isPlainObject(value)) return false;
  if (value.outcome !== "ok" && value.outcome !== "error") return false;
  if (typeof value.startedAt !== "string" || typeof value.elapsedMs !== "number") return false;
  const request = value.request;
  if (!isPlainObject(request) || typeof request.url !== "string" || typeof request.method !== "string") return false;
  return true;
}

export function readImportHistory(storage: Storage = window.localStorage): readonly RecipeImportDiagnostic[] {
  const raw = storage.getItem(HISTORY_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDiagnostic).slice(0, MAX_IMPORT_HISTORY);
  } catch {
    return [];
  }
}

/** Prepends one diagnostic and truncates to `MAX_IMPORT_HISTORY` — called once per settled request (success or failure alike), so a household can see a failure alongside the successful attempts around it, not just the one that just broke. */
export function recordImportAttempt(diagnostic: RecipeImportDiagnostic, storage: Storage = window.localStorage): void {
  const current = readImportHistory(storage);
  const next = [diagnostic, ...current].slice(0, MAX_IMPORT_HISTORY);
  storage.setItem(HISTORY_KEY, JSON.stringify(next));
}

/** The history panel's own "Clear" action — never left implicit only in a cap; the owner's "clearable" is a first-class affordance, not just eviction. */
export function clearImportHistory(storage: Storage = window.localStorage): void {
  storage.removeItem(HISTORY_KEY);
}
