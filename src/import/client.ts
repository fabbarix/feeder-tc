/**
 * The one network call this feature makes — DESIGN_RECIPE_IMPORT.md §6/§7:
 * "One request per import. No multi-turn conversation, no tool calls, no
 * streaming." A single `POST {baseUrl}/chat/completions` with a strict
 * `json_schema` response format, a client-side timeout (§7's "hard
 * client-side timeout" bound), and exactly one automatic retry never built
 * in — a failure surfaces as an error, it is not silently re-sent.
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
  | "invalid-response";

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
