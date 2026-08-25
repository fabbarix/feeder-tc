/**
 * The network calls this feature makes.
 *
 * `importRecipeFromText` — DESIGN_RECIPE_IMPORT.md §6/§7: "One request per
 * import. No multi-turn conversation, no tool calls, no streaming." A single
 * `POST {baseUrl}/chat/completions` with a strict `json_schema` response
 * format, a client-side timeout (§7's "hard client-side timeout" bound), and
 * exactly one automatic retry never built in — a failure surfaces as an
 * error, it is not silently re-sent.
 *
 * `importRecipeFromLink` — added on top of that design per the owner's
 * 2026-08-24 decisions (DESIGN_RECIPE_IMPORT.md, "Decisions" §2/§3): a
 * household may declare, in Settings, that their configured address
 * implements the **Responses API** with a browser/web-search tool wired up
 * (OpenAI itself, or a deliberately configured vLLM `--tool-server`). One
 * request, `POST {baseUrl}/responses`, carrying the page's URL in the input
 * and the browser tool enabled — the endpoint fetches the page itself, not
 * this app (invariant 7: no backend of ours ever fetches an arbitrary URL).
 * The response still has to become the exact same `ParsedRecipeDraft` the
 * text path produces, so it is validated through the identical
 * `validateRecipeImportResponse` — one matcher, two ways to reach it, never
 * two implementations of "is this a usable recipe."
 *
 * The browser tool itself is requested in one of two shapes, per a second
 * owner follow-up the same day, once vLLM's actual docs were checked rather
 * than assumed: OpenAI's is a native `web_search_preview` tool type built
 * into the address the household already entered; vLLM's is reached through
 * MCP, at a *second* address (`toolServerUrl`, optional, blank by default —
 * `buildLinkTools` below picks the shape). Neither shape has been exercised
 * against a real server from this repo — CI mocks both, nothing more.
 *
 * Every failure mode is a typed `RecipeImportError` with a `reason`
 * discriminant; `src/import/error-messages.ts` turns each into the
 * plain-language sentence a cook actually reads (no "endpoint," "token,"
 * "model," "API," or "schema" — CLAUDE.md's jargon rule, `error-messages.ts`
 * pattern from `src/sheets`).
 *
 * **Diagnostics (owner's 2026-08-25 report):** every `RecipeImportError`
 * also carries an optional `diagnostic` (`./diagnostics.ts`'s
 * `RecipeImportDiagnostic`) — the plain-language `message` above stays the
 * only thing a cook has to read, but a household debugging their own server
 * gets the actual request/response underneath, one tap away
 * (`RecipeImport.tsx`'s "Show details"). Six previously-identical
 * "couldn't make sense of what came back" throw sites (one per request
 * path × {response body wasn't JSON, no content field, content wasn't
 * JSON} plus one shared schema-mismatch/no-ingredients pair from
 * `match.ts`) are now told apart by `diagnostic.cause`
 * (`ImportFailureCause`, `./diagnostics.ts`):
 *
 *  - `unparseable-body` — the HTTP response body itself wasn't valid JSON.
 *  - `missing-content` — valid JSON, but no `choices[0].message.content`
 *    (Chat Completions) / `output_text` (Responses) could be found in it.
 *  - `content-not-json` — that content existed but wasn't itself valid
 *    JSON ("the reply was prose, not the structured object asked for").
 *  - `schema-mismatch` — valid JSON, but didn't match the requested shape
 *    (`match.ts`'s `validateRecipeImportResponse`, now with structured
 *    field/expected/received detail attached).
 *  - `no-ingredients` — valid, correctly-shaped JSON with zero ingredient
 *    lines (`match.ts`'s newest check — this used to fail silently into
 *    the same bucket as every other schema problem).
 *  - `bad-status` — reached the address, but got back a status this client
 *    doesn't already have its own headline for (401/403/429/404 all keep
 *    their own specific `reason`s; anything else lands here).
 *
 * A raw API key never reaches a diagnostic (`diagnostics.ts`'s
 * `redactHeaders` strips it before a request summary is ever built) and a
 * photo import's request body never carries its base64 payloads into one
 * either (`summarizeRequestBody` replaces each `data:image/...` part with a
 * size/dimensions summary) — see that module's own doc comment for the
 * invariant this file leans on.
 *
 * **Tolerant parsing (owner's 2026-08-25 report, real evidence):** an actual
 * OpenRouter reply (`gpt-4o-mini`, `/responses`, `strict: true` requested)
 * came back HTTP 200 wrapped in a ```json fence, with `title` instead of
 * `name`, `steps` as plain strings, units outside our enum, and `note: null`
 * — five schema divergences at once, from an endpoint that had been asked,
 * strictly, not to do any of them. `strict` mode is best-effort at best (see
 * `buildLinkRequestBody`'s own comment) against "any OpenAI-compatible
 * endpoint," so every one of the three functions below runs its reply
 * through `./normalize.ts` — fence-stripping, then a small conservative set
 * of shape fixes — before `match.ts`'s existing strict validation ever sees
 * it (`parseValidateAndCoerce`, shared by all three). Every fix normalize.ts
 * makes is returned as a plain-language string on the resulting
 * `ParsedRecipeDraft.coercions`, shown on the review screen
 * (`RecipeEditor.tsx`) — never applied invisibly. `normalize.ts` fixes
 * shape only; a reply that genuinely isn't a recipe, or is missing real
 * content, still fails validation exactly as before.
 */
import { validateRecipeImportResponse, type ParsedRecipeDraft } from "./match.ts";
import { normalizeRecipeImportPayload, stripJsonFence } from "./normalize.ts";
import {
  finalizeDiagnostic,
  redactHeaders,
  summarizeRequestBody,
  type ImportFailureCause,
  type ImportProgressStage,
  type ImportRequestSummary,
  type ImportToolActionSummary,
  type RecipeImportDiagnostic,
} from "./diagnostics.ts";
import { classifySourceVerification, extractResponsesProvenance, type ResponsesProvenance } from "./source-verification.ts";

export type RecipeImportErrorReason =
  | "not-configured"
  | "offline"
  | "daily-limit"
  | "timeout"
  | "network"
  | "unauthorized"
  | "rate-limited"
  | "invalid-response"
  | "tool-unsupported";

export class RecipeImportError extends Error {
  readonly reason: RecipeImportErrorReason;
  /** The debugging detail behind this failure — see this file's own doc comment. Absent only for `not-configured`/`offline`/`daily-limit`, which never reach the network at all. */
  readonly diagnostic?: RecipeImportDiagnostic;
  constructor(reason: RecipeImportErrorReason, message: string, diagnostic?: RecipeImportDiagnostic) {
    super(message);
    this.name = "RecipeImportError";
    this.reason = reason;
    if (diagnostic !== undefined) this.diagnostic = diagnostic;
  }
}

/** Drops any `undefined` field rather than assigning it explicitly — required under `exactOptionalPropertyTypes`, and incidentally exactly right for the diagnostic anyway: a validation failure with no particular field (e.g. "not a recipe") should have no `validation` keys at all, not a `{field: undefined}` noise. */
function validationDetail(validation: {
  readonly field?: string;
  readonly expected?: string;
  readonly received?: string;
}): { readonly field?: string; readonly expected?: string; readonly received?: string } {
  return {
    ...(validation.field !== undefined ? { field: validation.field } : {}),
    ...(validation.expected !== undefined ? { expected: validation.expected } : {}),
    ...(validation.received !== undefined ? { received: validation.received } : {}),
  };
}

const REQUEST_TIMEOUT_MS = 30_000;

/** Progress-callback shape shared by all three request functions — `RecipeImport.tsx` uses this to show "Sending your recipe… 3s" style copy while a request (which can easily run fifteen seconds or more) is in flight. */
export type ImportProgressCallback = (stage: ImportProgressStage, elapsedMs: number) => void;

function reportProgress(onProgress: ImportProgressCallback | undefined, stage: ImportProgressStage, startedAtMs: number): void {
  onProgress?.(stage, Date.now() - startedAtMs);
}

function errorDiagnostic(
  startedAtMs: number,
  request: ImportRequestSummary,
  extra: {
    readonly httpStatus?: number;
    readonly httpStatusText?: string;
    readonly responseBodyText?: string;
    readonly cause?: ImportFailureCause;
    readonly validation?: { readonly field?: string; readonly expected?: string; readonly received?: string };
    readonly toolActions?: readonly ImportToolActionSummary[];
    readonly citedUrls?: readonly string[];
  } = {},
): RecipeImportDiagnostic {
  return finalizeDiagnostic({ outcome: "error", startedAtMs, request, ...extra });
}

const GENERIC_NETWORK_MESSAGE =
  "Feeder couldn't reach that address from your browser. If this is your own server, check it's running and that it allows requests from this website.";
const GENERIC_INVALID_RESPONSE_MESSAGE = "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.";

/**
 * Hardening added on top of DESIGN_RECIPE_IMPORT.md §6's own words, per the
 * owner's 2026-08-25 follow-up: real evidence (an OpenRouter reply, `strict:
 * true` requested and ignored) shows a compliant-looking endpoint still
 * fencing its JSON, renaming a key, and flattening a step to a plain
 * string. Spelling out the fence ban, the exact keys, and a worked example
 * costs nothing and measurably reduces how often `normalize.ts` has
 * anything to fix — but it is not a substitute for that module, only a
 * cheaper first line of defence. Shared verbatim by the text, photo, and
 * link prompts below so the one hardening pass covers all three paths
 * identically.
 */
const RECIPE_IMPORT_FORMAT_INSTRUCTION =
  "Respond with a single JSON object and nothing else — no markdown code fences (no ``` anywhere in your reply), " +
  "no commentary before or after it, no explanation. Use exactly these top-level keys: isRecipe, name, servings, " +
  "prepMinutes, cookMinutes, ingredients, steps. Each item in ingredients is an object with exactly these keys: " +
  "name, amount, unit, note. Each item in steps is an object with exactly this key: description — never a plain " +
  'string. Example shape (the values are illustrative only, not a real recipe to copy): ' +
  '{"isRecipe":true,"name":"Garlic Rice","servings":4,"prepMinutes":5,"cookMinutes":20,' +
  '"ingredients":[{"name":"garlic","amount":2,"unit":"piece","note":""}],' +
  '"steps":[{"description":"Cook the rice with garlic."}]}';

/** DESIGN_RECIPE_IMPORT.md §6's system prompt, plus `RECIPE_IMPORT_FORMAT_INSTRUCTION`'s hardening above. */
export const RECIPE_IMPORT_SYSTEM_PROMPT =
  "You are extracting a recipe from text a home cook pasted from a webpage. Return only what the schema asks for. " +
  'Use the ingredient\'s most common household name ("garlic", not "garlic cloves, minced"). If an amount has no ' +
  'clear unit (e.g. "a pinch", "to taste"), set unit to null and put the original words in note. If the pasted ' +
  "text is not a recipe at all (an article, an ad, an unrelated page), set isRecipe to false and leave everything " +
  "else empty. Never invent ingredients, steps, or amounts that are not in the text. If servings aren't stated, " +
  "leave servings null rather than guessing. " +
  RECIPE_IMPORT_FORMAT_INSTRUCTION;

/** DESIGN_RECIPE_IMPORT.md §6's schema, transcribed exactly — every field required, `additionalProperties: false`, optionality expressed as nullable. */
export const RECIPE_IMPORT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isRecipe", "name", "servings", "prepMinutes", "cookMinutes", "ingredients", "steps"],
  properties: {
    isRecipe: { type: "boolean" },
    name: { type: "string" },
    servings: { type: ["integer", "null"] },
    prepMinutes: { type: ["integer", "null"] },
    cookMinutes: { type: ["integer", "null"] },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "amount", "unit", "note"],
        properties: {
          name: { type: "string" },
          amount: { type: ["number", "null"] },
          unit: {
            type: ["string", "null"],
            enum: ["kg", "g", "lb", "oz", "l", "ml", "fl oz", "piece", "cup", "tbsp", "tsp", null],
          },
          note: { type: "string" },
        },
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description"],
        properties: { description: { type: "string" } },
      },
    },
  },
} as const;

export interface ImportRecipeParams {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly pastedText: string;
  /** Stored only as a note in the request — never fetched by the app itself (DESIGN_RECIPE_IMPORT.md §3). */
  readonly sourceUrl?: string;
}

function buildRequestBody(params: ImportRecipeParams): unknown {
  const userContent = params.sourceUrl
    ? `Source: ${params.sourceUrl}\n\n${params.pastedText}`
    : params.pastedText;
  return {
    model: params.model.trim() === "" ? "gpt-4o-mini" : params.model,
    messages: [
      { role: "system", content: RECIPE_IMPORT_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "recipe_import", strict: true, schema: RECIPE_IMPORT_JSON_SCHEMA },
    },
  };
}

function extractMessageContent(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const choices = (json as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  return typeof content === "string" ? content : undefined;
}

function chatCompletionsRequestSummary(url: string, model: string, headers: Record<string, string>, body: unknown): ImportRequestSummary {
  return { url, method: "POST", model, headers: redactHeaders(headers), body: summarizeRequestBody(body) };
}

/**
 * The shared tail of all three request functions below, from "we have the
 * model's raw reply text" onward — `normalize.ts`'s two jobs (recover JSON
 * out of a fenced/prose-wrapped reply, then reshape known schema
 * divergences) followed by `match.ts`'s existing strict validation. One
 * implementation rather than three near-identical copies, so a future fix
 * here can't accidentally land on only one of the three request paths.
 *
 * `strict: true` on the request is not a guarantee — see this file's own
 * doc comment and `buildLinkRequestBody`'s — so every one of the three
 * callers reaches this exact code whether or not the endpoint claims to
 * honour it.
 */
/** Link-import-only provenance to fold into a validation-failure diagnostic — absent for the text/photo paths, which never have any. */
interface LinkProvenanceForDiagnostic {
  readonly toolActions?: readonly ImportToolActionSummary[];
  readonly citedUrls?: readonly string[];
}

function parseValidateAndCoerce(
  content: string,
  startedAtMs: number,
  request: ImportRequestSummary,
  responseStatus: number,
  bodyText: string,
  linkProvenance: LinkProvenanceForDiagnostic = {},
): ParsedRecipeDraft {
  const { text: jsonText, fenceStripped } = stripJsonFence(content);

  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(jsonText);
  } catch {
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, {
        httpStatus: responseStatus,
        responseBodyText: bodyText,
        cause: "content-not-json",
        ...linkProvenance,
      }),
    );
  }

  const { value: normalized, coercions: shapeCoercions } = normalizeRecipeImportPayload(rawParsed);
  // Fence-stripping counts as its own visible coercion — "we changed what
  // you asked for" applies just as much to reading JSON out of a fence as
  // to reshaping a field inside it (owner's requirement: "every coercion
  // must be visible in the review screen, not silent").
  const coercions = fenceStripped
    ? ["The reply was wrapped in a code fence — read the JSON found inside it.", ...shapeCoercions]
    : shapeCoercions;

  const validation = validateRecipeImportResponse(normalized);
  if (!validation.ok) {
    throw new RecipeImportError(
      "invalid-response",
      validation.reason,
      errorDiagnostic(startedAtMs, request, {
        httpStatus: responseStatus,
        responseBodyText: bodyText,
        cause: validation.reason === "The response listed no ingredients at all." ? "no-ingredients" : "schema-mismatch",
        validation: validationDetail(validation),
        ...linkProvenance,
      }),
    );
  }
  return { ...validation.draft, coercions };
}

/**
 * Sends the one import request and returns a validated draft, or throws a
 * `RecipeImportError`. Never writes anything, never retries on its own —
 * every retry the household sees is a fresh tap of "Read this recipe".
 */
export async function importRecipeFromText(
  params: ImportRecipeParams,
  fetchImpl: typeof fetch = fetch,
  onProgress?: ImportProgressCallback,
): Promise<ParsedRecipeDraft> {
  const startedAtMs = Date.now();
  const url = `${params.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const model = params.model.trim() === "" ? "gpt-4o-mini" : params.model;
  const requestBody = buildRequestBody(params);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` };
  const request = chatCompletionsRequestSummary(url, model, headers, requestBody);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  reportProgress(onProgress, "sending", startedAtMs);

  let response: Response;
  try {
    reportProgress(onProgress, "waiting", startedAtMs);
    response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(requestBody), signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new RecipeImportError(
        "timeout",
        "That took too long — try again, or check the address in Settings.",
        errorDiagnostic(startedAtMs, request),
      );
    }
    throw new RecipeImportError("network", GENERIC_NETWORK_MESSAGE, errorDiagnostic(startedAtMs, request));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RecipeImportError(
        "unauthorized",
        "That password wasn't accepted — check it's typed correctly, or that it hasn't expired.",
        errorDiagnostic(startedAtMs, request, { httpStatus: response.status, httpStatusText: response.statusText }),
      );
    }
    if (response.status === 429) {
      throw new RecipeImportError(
        "rate-limited",
        "The service you're using to read recipes is busy right now — try again in a moment.",
        errorDiagnostic(startedAtMs, request, { httpStatus: response.status, httpStatusText: response.statusText }),
      );
    }
    const bodyText = await response.text().catch(() => "");
    throw new RecipeImportError(
      "network",
      GENERIC_NETWORK_MESSAGE,
      errorDiagnostic(startedAtMs, request, {
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseBodyText: bodyText,
        cause: "bad-status",
      }),
    );
  }

  reportProgress(onProgress, "reading", startedAtMs);
  const bodyText = await response.text().catch(() => undefined);
  if (bodyText === undefined) {
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, { httpStatus: response.status, cause: "unparseable-body" }),
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, { httpStatus: response.status, responseBodyText: bodyText, cause: "unparseable-body" }),
    );
  }

  const content = extractMessageContent(json);
  if (content === undefined) {
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, { httpStatus: response.status, responseBodyText: bodyText, cause: "missing-content" }),
    );
  }

  reportProgress(onProgress, "checking", startedAtMs);
  return parseValidateAndCoerce(content, startedAtMs, request, response.status, bodyText);
}

/**
 * Same instructions as the text path's system prompt, plus the
 * photo-specific rules DESIGN_RECIPE_IMPORT_PHOTO.md §9 asks for: transcribe
 * exactly what's on the page rather than inventing/completing/improving it,
 * treat multiple images as one continuous recipe unless clearly unrelated,
 * and give a literal best-reading rather than a plausible guess when
 * something is unclear.
 */
export const RECIPE_IMPORT_PHOTO_SYSTEM_PROMPT =
  "You are transcribing a recipe from one or more photographs of a cookbook page, recipe card, or clipping into " +
  "structured data. Return only what the schema asks for. Use the ingredient's most common household name " +
  '("garlic", not "garlic cloves, minced"). If an amount has no clear unit (e.g. "a pinch", "to taste"), set unit ' +
  "to null and put the original words in note. If the photograph is not a recipe at all, set isRecipe to false and " +
  "leave everything else empty. Never invent ingredients, steps, or amounts that are not shown in the photograph. " +
  "If servings aren't stated, leave servings null rather than guessing. Transcribe exactly what is written — do " +
  "not invent, complete, or improve the recipe. If a quantity or word is unclear or illegible, give your best " +
  "literal reading anyway rather than a plausible-sounding guess; never silently substitute a value that merely " +
  "sounds right for what is actually written. If multiple images are provided, treat them as one continuous " +
  "recipe (for example, ingredients on one page and the method continued on another) unless they are clearly " +
  "unrelated to each other. " +
  RECIPE_IMPORT_FORMAT_INSTRUCTION;

export interface ImportRecipeFromPhotosParams {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** 1-3 already-encoded model-input photos (data URLs) — see `src/import/photo-encode.ts`. The UI caps this at 3; this function trusts its caller rather than re-validating the count itself. */
  readonly photos: readonly string[];
}

function buildPhotoRequestBody(params: ImportRecipeFromPhotosParams): unknown {
  return {
    model: params.model.trim() === "" ? "gpt-4o-mini" : params.model,
    messages: [
      { role: "system", content: RECIPE_IMPORT_PHOTO_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this recipe." },
          ...params.photos.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } })),
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "recipe_import", strict: true, schema: RECIPE_IMPORT_JSON_SCHEMA },
    },
  };
}

/**
 * Sends the one photo-import request — up to 3 images, one `/chat/completions`
 * call, same timeout/error-mapping/validation shape as `importRecipeFromText`
 * (this is the Chat Completions endpoint, not the Responses API — no browser
 * tool is involved in reading a photo). Returns a validated draft, or throws
 * a `RecipeImportError`. The photos never reach a diagnostic as themselves —
 * `chatCompletionsRequestSummary` runs the same body through
 * `summarizeRequestBody`, which replaces every `image_url.url` data URI with
 * a size/dimensions summary before it is attached to anything.
 */
export async function importRecipeFromPhotos(
  params: ImportRecipeFromPhotosParams,
  fetchImpl: typeof fetch = fetch,
  onProgress?: ImportProgressCallback,
): Promise<ParsedRecipeDraft> {
  const startedAtMs = Date.now();
  const url = `${params.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const model = params.model.trim() === "" ? "gpt-4o-mini" : params.model;
  const requestBody = buildPhotoRequestBody(params);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` };
  const request = chatCompletionsRequestSummary(url, model, headers, requestBody);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  reportProgress(onProgress, "sending", startedAtMs);

  let response: Response;
  try {
    reportProgress(onProgress, "waiting", startedAtMs);
    response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(requestBody), signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new RecipeImportError(
        "timeout",
        "That took too long — try again, or check the address in Settings.",
        errorDiagnostic(startedAtMs, request),
      );
    }
    throw new RecipeImportError("network", GENERIC_NETWORK_MESSAGE, errorDiagnostic(startedAtMs, request));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RecipeImportError(
        "unauthorized",
        "That password wasn't accepted — check it's typed correctly, or that it hasn't expired.",
        errorDiagnostic(startedAtMs, request, { httpStatus: response.status, httpStatusText: response.statusText }),
      );
    }
    if (response.status === 429) {
      throw new RecipeImportError(
        "rate-limited",
        "The service you're using to read recipes is busy right now — try again in a moment.",
        errorDiagnostic(startedAtMs, request, { httpStatus: response.status, httpStatusText: response.statusText }),
      );
    }
    const bodyText = await response.text().catch(() => "");
    throw new RecipeImportError(
      "network",
      GENERIC_NETWORK_MESSAGE,
      errorDiagnostic(startedAtMs, request, {
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseBodyText: bodyText,
        cause: "bad-status",
      }),
    );
  }

  reportProgress(onProgress, "reading", startedAtMs);
  const bodyText = await response.text().catch(() => undefined);
  if (bodyText === undefined) {
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, { httpStatus: response.status, cause: "unparseable-body" }),
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, { httpStatus: response.status, responseBodyText: bodyText, cause: "unparseable-body" }),
    );
  }

  const content = extractMessageContent(json);
  if (content === undefined) {
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, { httpStatus: response.status, responseBodyText: bodyText, cause: "missing-content" }),
    );
  }

  reportProgress(onProgress, "checking", startedAtMs);
  return parseValidateAndCoerce(content, startedAtMs, request, response.status, bodyText);
}

export interface ImportRecipeFromLinkParams {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** The page to open — sent to the endpoint, never fetched by this app itself. */
  readonly url: string;
  /**
   * Optional address of a separate web-reading helper — `RecipeImportSettings.tsx`'s
   * "your own web-reading helper" field. Owner's 2026-08-24 follow-up:
   * OpenAI's browser tool is built into the address above (no second
   * address needed), but a vLLM `--tool-server` deployment reaches its
   * browser tool through a *second* address via MCP, so the two shapes
   * genuinely differ and the household has to say which one they have.
   */
  readonly toolServerUrl?: string;
}

/**
 * Same instructions as the text path, plus telling the model it has to fetch
 * the page rather than being handed it.
 *
 * Hardened per the owner's 2026-08-25 report: real evidence shows this
 * request can come back having *searched* for the page instead of opening
 * it directly — one search, five candidate pages, several sharing the same
 * dish's name under a different recipe. It happened to open the right one
 * that time, but nothing about a search step guarantees that. Spelling out
 * "open this exact address, do not search for it" costs nothing and cannot
 * by itself force the point — OpenAI's native `web_search_preview` tool
 * gives the model that choice with no way for this client to take it away
 * (`buildLinkTools`'s own doc comment) — which is exactly why
 * `./source-verification.ts` exists to detect the outcome afterwards rather
 * than trust the instruction was followed.
 */
const RECIPE_IMPORT_LINK_INSTRUCTION =
  "Open this exact address and read the recipe from its content — do not search for it, and do not substitute a " +
  "different page even if it looks like the same recipe. Then extract it exactly as instructed above. If the page " +
  "doesn't load, or isn't a recipe once you've read it, set isRecipe to false.";

/**
 * The one browsing tool this feature ever asks for, in whichever of the two
 * documented Responses-API shapes the household's own setup needs — verified
 * against OpenAI's own docs and vLLM's docs (2026-08-24 follow-up), not
 * assumed to be the same shape:
 *
 *  - **No `toolServerUrl`** (OpenAI, or anything that speaks OpenAI's own
 *    Responses API dialect): the built-in `web_search_preview` tool type,
 *    nothing further to configure — this is the default and needs no extra
 *    Settings field filled in.
 *  - **`toolServerUrl` set** (a vLLM `--tool-server` deployment): vLLM's
 *    browser tool isn't a native tool type — it's reached through MCP, named
 *    by a `server_label`/`server_url` pair, with sub-tools `search`, `open`,
 *    `find` gated by `allowed_tools`. `open` is the one that opens a
 *    specific URL rather than searching for one (matches the earlier
 *    spike's reading of `simple_browser_tool.py`'s `direct_url_open`) — it
 *    is always requested; `search` is not, because this feature only ever
 *    hands the model one exact address, never "find something like this."
 */
function buildLinkTools(toolServerUrl: string | undefined): unknown[] {
  const trimmed = toolServerUrl?.trim();
  if (trimmed === undefined || trimmed === "") {
    return [{ type: "web_search_preview" }];
  }
  return [{ type: "mcp", server_label: "web_search_preview", server_url: trimmed, allowed_tools: ["open"] }];
}

/**
 * `text.format.json_schema` is `/responses`' own documented structured-output
 * shape, but — per this file's top doc comment — it is best-effort, not a
 * guarantee: OpenRouter's own docs describe `strict` mode as enforced only
 * by "supported providers" on `/chat/completions`'s `response_format`, and
 * say nothing about `/responses` honouring it at all. `normalize.ts` is the
 * actual backstop; this field is just "ask nicely first."
 *
 * Deliberately NOT also sending `response_format` here as a second attempt
 * at the same thing: checked, not guessed (owner's requirement) — OpenAI's
 * own `/v1/responses` endpoint uses the same strict "reject anything it
 * doesn't recognise" parameter validation reported all over their developer
 * forum and support channels as "Unrecognized request argument supplied:
 * response_format" for exactly this mistake (a Chat-Completions-only field
 * sent to the Responses API). Since OpenAI itself is the reference
 * implementation of this endpoint shape (`buildLinkTools`'s own doc comment
 * — the no-`toolServerUrl` default), adding `response_format` here would
 * turn "a provider that ignores `text.format`" into "a hard 400 on OpenAI
 * itself, every time" — strictly worse than leaving it out.
 */
function buildLinkRequestBody(params: ImportRecipeFromLinkParams): unknown {
  return {
    model: params.model.trim() === "" ? "gpt-4o-mini" : params.model,
    input: [
      { role: "system", content: `${RECIPE_IMPORT_SYSTEM_PROMPT} ${RECIPE_IMPORT_LINK_INSTRUCTION}` },
      { role: "user", content: `Recipe page: ${params.url}` },
    ],
    tools: buildLinkTools(params.toolServerUrl),
    text: {
      format: { type: "json_schema", name: "recipe_import", strict: true, schema: RECIPE_IMPORT_JSON_SCHEMA },
    },
  };
}

/** A word that shows up in an endpoint's rejection of an unrecognised `tools`/Responses-API request — heuristic, not a documented contract, because every provider phrases this differently. False positives just mean a genuine failure is (correctly) described as "this address doesn't support that" instead of a generic network error; both tell the cook to try something else. */
const TOOL_UNSUPPORTED_HINT = /\b(tool|tools|mcp|web_search|browser|server_url|server_label|responses api|unsupported|unknown (type|parameter)|not (support|implement))\b/i;

function extractResponsesOutputText(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const obj = json as Record<string, unknown>;
  if (typeof obj.output_text === "string" && obj.output_text.trim() !== "") return obj.output_text;

  const output = obj.output;
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (rec.type !== "message") continue;
    const content = rec.content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      if (typeof contentItem !== "object" || contentItem === null) continue;
      const contentRec = contentItem as Record<string, unknown>;
      if (contentRec.type === "output_text" && typeof contentRec.text === "string") return contentRec.text;
    }
  }
  return undefined;
}

function extractResponsesErrorMessage(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const obj = json as Record<string, unknown>;
  const err = obj.error;
  if (typeof err !== "object" || err === null) return undefined;
  const message = (err as Record<string, unknown>).message;
  return typeof message === "string" ? message : undefined;
}

const TOOL_UNSUPPORTED_MESSAGE =
  "This address doesn't seem to support reading a recipe straight from a link. Turn off “This address can open a web link” in Settings and paste the recipe's text instead, or use an address that supports it.";

/**
 * Sends the one link-import request and returns a validated draft, or
 * throws a `RecipeImportError`. Reuses `validateRecipeImportResponse` from
 * `./match.ts` — the review screen a household lands on is indistinguishable
 * from the text path's, because it is built from the same shape.
 */
export async function importRecipeFromLink(
  params: ImportRecipeFromLinkParams,
  fetchImpl: typeof fetch = fetch,
  onProgress?: ImportProgressCallback,
): Promise<ParsedRecipeDraft> {
  const startedAtMs = Date.now();
  const url = `${params.baseUrl.replace(/\/+$/, "")}/responses`;
  const model = params.model.trim() === "" ? "gpt-4o-mini" : params.model;
  const requestBody = buildLinkRequestBody(params);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` };
  const request: ImportRequestSummary = { url, method: "POST", model, headers: redactHeaders(headers), body: summarizeRequestBody(requestBody) };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  reportProgress(onProgress, "sending", startedAtMs);

  let response: Response;
  try {
    reportProgress(onProgress, "waiting", startedAtMs);
    response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(requestBody), signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new RecipeImportError(
        "timeout",
        "That took too long — try again, or check the address in Settings.",
        errorDiagnostic(startedAtMs, request),
      );
    }
    throw new RecipeImportError("network", GENERIC_NETWORK_MESSAGE, errorDiagnostic(startedAtMs, request));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RecipeImportError(
        "unauthorized",
        "That password wasn't accepted — check it's typed correctly, or that it hasn't expired.",
        errorDiagnostic(startedAtMs, request, { httpStatus: response.status, httpStatusText: response.statusText }),
      );
    }
    if (response.status === 429) {
      throw new RecipeImportError(
        "rate-limited",
        "The service you're using to read recipes is busy right now — try again in a moment.",
        errorDiagnostic(startedAtMs, request, { httpStatus: response.status, httpStatusText: response.statusText }),
      );
    }
    if (response.status === 404) {
      throw new RecipeImportError(
        "tool-unsupported",
        TOOL_UNSUPPORTED_MESSAGE,
        errorDiagnostic(startedAtMs, request, { httpStatus: response.status, httpStatusText: response.statusText }),
      );
    }
    const bodyText = await response.text().catch(() => "");
    if (response.status === 400 && TOOL_UNSUPPORTED_HINT.test(bodyText)) {
      throw new RecipeImportError(
        "tool-unsupported",
        TOOL_UNSUPPORTED_MESSAGE,
        errorDiagnostic(startedAtMs, request, { httpStatus: response.status, httpStatusText: response.statusText, responseBodyText: bodyText }),
      );
    }
    throw new RecipeImportError(
      "network",
      GENERIC_NETWORK_MESSAGE,
      errorDiagnostic(startedAtMs, request, {
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseBodyText: bodyText,
        cause: "bad-status",
      }),
    );
  }

  reportProgress(onProgress, "reading", startedAtMs);
  const bodyText = await response.text().catch(() => undefined);
  if (bodyText === undefined) {
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, { httpStatus: response.status, cause: "unparseable-body" }),
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, { httpStatus: response.status, responseBodyText: bodyText, cause: "unparseable-body" }),
    );
  }

  const errorMessage = extractResponsesErrorMessage(json);
  if (errorMessage !== undefined) {
    if (TOOL_UNSUPPORTED_HINT.test(errorMessage)) {
      throw new RecipeImportError(
        "tool-unsupported",
        TOOL_UNSUPPORTED_MESSAGE,
        errorDiagnostic(startedAtMs, request, { httpStatus: response.status, responseBodyText: bodyText }),
      );
    }
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, { httpStatus: response.status, responseBodyText: bodyText, cause: "missing-content" }),
    );
  }

  const content = extractResponsesOutputText(json);
  if (content === undefined) {
    throw new RecipeImportError(
      "invalid-response",
      GENERIC_INVALID_RESPONSE_MESSAGE,
      errorDiagnostic(startedAtMs, request, { httpStatus: response.status, responseBodyText: bodyText, cause: "missing-content" }),
    );
  }

  // Provenance (owner's 2026-08-25 report, "make link import prove it read
  // the page the cook asked for"): whatever the reply itself says it did —
  // a `web_search_call`'s action type/candidates, and any `url_citation`
  // annotation naming the page it actually read. Folded into every
  // remaining diagnostic below (success or a later validation failure
  // alike), and — on success — turned into the plain classification
  // `RecipeEditor.tsx` reads to decide whether the review screen needs to
  // say anything (`./source-verification.ts`'s own doc comment).
  const provenance: ResponsesProvenance = extractResponsesProvenance(json);
  const linkProvenance: LinkProvenanceForDiagnostic = {
    ...(provenance.toolActions.length > 0 ? { toolActions: provenance.toolActions } : {}),
    ...(provenance.citedUrls.length > 0 ? { citedUrls: provenance.citedUrls } : {}),
  };

  reportProgress(onProgress, "checking", startedAtMs);
  const draft = parseValidateAndCoerce(content, startedAtMs, request, response.status, bodyText, linkProvenance);
  const sourceVerification = classifySourceVerification(params.url, provenance);
  const diagnostic = finalizeDiagnostic({
    outcome: "ok",
    startedAtMs,
    request,
    httpStatus: response.status,
    responseBodyText: bodyText,
    ...linkProvenance,
  });
  return { ...draft, sourceVerification, diagnostic };
}
