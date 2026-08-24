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
 */
import { validateRecipeImportResponse, type ParsedRecipeDraft } from "./match.ts";

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
  constructor(reason: RecipeImportErrorReason, message: string) {
    super(message);
    this.name = "RecipeImportError";
    this.reason = reason;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

/** DESIGN_RECIPE_IMPORT.md §6's system prompt, verbatim — the model's only instructions. */
export const RECIPE_IMPORT_SYSTEM_PROMPT =
  "You are extracting a recipe from text a home cook pasted from a webpage. Return only what the schema asks for. " +
  'Use the ingredient\'s most common household name ("garlic", not "garlic cloves, minced"). If an amount has no ' +
  'clear unit (e.g. "a pinch", "to taste"), set unit to null and put the original words in note. If the pasted ' +
  "text is not a recipe at all (an article, an ad, an unrelated page), set isRecipe to false and leave everything " +
  "else empty. Never invent ingredients, steps, or amounts that are not in the text. If servings aren't stated, " +
  "leave servings null rather than guessing.";

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

/**
 * Sends the one import request and returns a validated draft, or throws a
 * `RecipeImportError`. Never writes anything, never retries on its own —
 * every retry the household sees is a fresh tap of "Read this recipe".
 */
export async function importRecipeFromText(
  params: ImportRecipeParams,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedRecipeDraft> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(`${params.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
      body: JSON.stringify(buildRequestBody(params)),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new RecipeImportError("timeout", "That took too long — try again, or check the address in Settings.");
    }
    throw new RecipeImportError(
      "network",
      "Feeder couldn't reach that address from your browser. If this is your own server, check it's running and that it allows requests from this website.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RecipeImportError("unauthorized", "That password wasn't accepted — check it's typed correctly, or that it hasn't expired.");
    }
    if (response.status === 429) {
      throw new RecipeImportError("rate-limited", "The service you're using to read recipes is busy right now — try again in a moment.");
    }
    throw new RecipeImportError(
      "network",
      "Feeder couldn't reach that address from your browser. If this is your own server, check it's running and that it allows requests from this website.",
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new RecipeImportError("invalid-response", "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.");
  }

  const content = extractMessageContent(json);
  if (content === undefined) {
    throw new RecipeImportError("invalid-response", "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new RecipeImportError("invalid-response", "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.");
  }

  const validation = validateRecipeImportResponse(parsed);
  if (!validation.ok) {
    throw new RecipeImportError("invalid-response", validation.reason);
  }
  return validation.draft;
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
  "unrelated to each other.";

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
 * a `RecipeImportError`.
 */
export async function importRecipeFromPhotos(
  params: ImportRecipeFromPhotosParams,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedRecipeDraft> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(`${params.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
      body: JSON.stringify(buildPhotoRequestBody(params)),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new RecipeImportError("timeout", "That took too long — try again, or check the address in Settings.");
    }
    throw new RecipeImportError(
      "network",
      "Feeder couldn't reach that address from your browser. If this is your own server, check it's running and that it allows requests from this website.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RecipeImportError("unauthorized", "That password wasn't accepted — check it's typed correctly, or that it hasn't expired.");
    }
    if (response.status === 429) {
      throw new RecipeImportError("rate-limited", "The service you're using to read recipes is busy right now — try again in a moment.");
    }
    throw new RecipeImportError(
      "network",
      "Feeder couldn't reach that address from your browser. If this is your own server, check it's running and that it allows requests from this website.",
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new RecipeImportError("invalid-response", "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.");
  }

  const content = extractMessageContent(json);
  if (content === undefined) {
    throw new RecipeImportError("invalid-response", "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new RecipeImportError("invalid-response", "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.");
  }

  const validation = validateRecipeImportResponse(parsed);
  if (!validation.ok) {
    throw new RecipeImportError("invalid-response", validation.reason);
  }
  return validation.draft;
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

/** Same instructions as the text path, plus telling the model it has to fetch the page rather than being handed it. */
const RECIPE_IMPORT_LINK_INSTRUCTION =
  "Open the page at the given address and read the recipe from its content, then extract it exactly as instructed above. " +
  "If the page doesn't load, or isn't a recipe once you've read it, set isRecipe to false.";

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

/**
 * Sends the one link-import request and returns a validated draft, or
 * throws a `RecipeImportError`. Reuses `validateRecipeImportResponse` from
 * `./match.ts` — the review screen a household lands on is indistinguishable
 * from the text path's, because it is built from the same shape.
 */
export async function importRecipeFromLink(
  params: ImportRecipeFromLinkParams,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedRecipeDraft> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(`${params.baseUrl.replace(/\/+$/, "")}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
      body: JSON.stringify(buildLinkRequestBody(params)),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new RecipeImportError("timeout", "That took too long — try again, or check the address in Settings.");
    }
    throw new RecipeImportError(
      "network",
      "Feeder couldn't reach that address from your browser. If this is your own server, check it's running and that it allows requests from this website.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RecipeImportError("unauthorized", "That password wasn't accepted — check it's typed correctly, or that it hasn't expired.");
    }
    if (response.status === 429) {
      throw new RecipeImportError("rate-limited", "The service you're using to read recipes is busy right now — try again in a moment.");
    }
    if (response.status === 404) {
      throw new RecipeImportError(
        "tool-unsupported",
        "This address doesn't seem to support reading a recipe straight from a link. Turn off “This address can open a web link” in Settings and paste the recipe's text instead, or use an address that supports it.",
      );
    }
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      // Body unreadable — bodyText stays "", falls through to the generic network error below.
    }
    if (response.status === 400 && TOOL_UNSUPPORTED_HINT.test(bodyText)) {
      throw new RecipeImportError(
        "tool-unsupported",
        "This address doesn't seem to support reading a recipe straight from a link. Turn off “This address can open a web link” in Settings and paste the recipe's text instead, or use an address that supports it.",
      );
    }
    throw new RecipeImportError(
      "network",
      "Feeder couldn't reach that address from your browser. If this is your own server, check it's running and that it allows requests from this website.",
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new RecipeImportError("invalid-response", "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.");
  }

  const errorMessage = extractResponsesErrorMessage(json);
  if (errorMessage !== undefined) {
    if (TOOL_UNSUPPORTED_HINT.test(errorMessage)) {
      throw new RecipeImportError(
        "tool-unsupported",
        "This address doesn't seem to support reading a recipe straight from a link. Turn off “This address can open a web link” in Settings and paste the recipe's text instead, or use an address that supports it.",
      );
    }
    throw new RecipeImportError("invalid-response", "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.");
  }

  const content = extractResponsesOutputText(json);
  if (content === undefined) {
    throw new RecipeImportError("invalid-response", "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new RecipeImportError("invalid-response", "Feeder couldn't make sense of what came back. You can try again, or add this recipe by hand.");
  }

  const validation = validateRecipeImportResponse(parsed);
  if (!validation.ok) {
    throw new RecipeImportError("invalid-response", validation.reason);
  }
  return validation.draft;
}
