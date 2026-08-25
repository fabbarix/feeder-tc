/**
 * Tolerant parsing — the layer that sits between "text a model actually sent
 * back" and `match.ts`'s `validateRecipeImportResponse`.
 *
 * Real evidence, not speculation: an owner-run link import against
 * OpenRouter (`gpt-4o-mini` via `/v1/responses`, `strict: true` requested on
 * `text.format.json_schema`) came back HTTP 200 with a reply diverging from
 * the requested schema in five independent ways at once — wrapped in a
 * ```json fence, `title` instead of `name`, `steps` as an array of strings
 * instead of `{ description }` objects, units outside our enum
 * (`"cloves"`, `"bunch"`), and `note: null` where the schema requires a
 * string. `strict: true` is documented by OpenRouter as enforced only by
 * "supported providers" on `/chat/completions`'s `response_format`, not
 * guaranteed at all for `/responses`' `text.format` — see `client.ts`'s own
 * comment above `buildLinkRequestBody`. Any endpoint claiming
 * OpenAI-compatibility can behave this way, so the parser has to stand on
 * its own rather than trusting the request it sent.
 *
 * Two pure, independent jobs, both deliberately conservative — "fix shape,
 * never invent content" (the owner's own line): a reply that is genuinely
 * not a recipe, or is missing real content, must still fail
 * `validateRecipeImportResponse` afterwards exactly as before. Neither
 * function here ever fills in an ingredient, a step, or a name that wasn't
 * in the reply somewhere.
 *
 *  1. `stripJsonFence` — recovers a JSON text from a reply that wrapped it
 *     in a markdown code fence and/or surrounded it with prose, WITHOUT
 *     ever fabricating JSON that wasn't there (a reply that plainly isn't
 *     JSON at all is returned unchanged, so it still fails at `JSON.parse`
 *     exactly as it did before this module existed).
 *  2. `normalizeRecipeImportPayload` — once something has parsed as JSON,
 *     reshapes known common divergences (a key alias, steps-as-strings, an
 *     out-of-enum unit, a null where a string belongs) into the exact shape
 *     `validateRecipeImportResponse` expects, and returns a plain-language
 *     description of every change it made. Every coercion is returned, not
 *     applied invisibly — `client.ts` attaches the list to the draft, and
 *     `RecipeEditor.tsx` shows it on the review screen (owner's requirement:
 *     "every coercion must be visible in the review screen, not silent").
 */
import { RECIPE_IMPORT_ENTRY_UNITS } from "./match.ts";
import type { EntryUnit } from "../domain/types.ts";

export interface FenceStripResult {
  readonly text: string;
  /** True only when something was actually stripped/extracted — a reply that was already bare JSON reports `false`, so `client.ts` never claims a coercion happened when it didn't. */
  readonly fenceStripped: boolean;
}

/** Finds the first balanced `{...}` substring starting at `text`'s first `{`, respecting quoted strings (so a `}` inside a string value doesn't end the object early). `undefined` if no balanced object exists. */
function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === "\\") escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Recovers a parseable JSON text from a model's raw reply. Tries, in order:
 * the text as-is; the inside of a ```json/``` fence; the first balanced
 * `{...}` object anywhere in the text (covers stray prose with no fence at
 * all, e.g. "Here's the recipe:\n{...}\nEnjoy!"). Falls back to the
 * original, untouched text — and `fenceStripped: false` — the moment none of
 * those parse, so a reply that genuinely isn't JSON still fails exactly
 * where it always did (`client.ts`'s `content-not-json` cause), never
 * silently swallowed here.
 */
export function stripJsonFence(raw: string): FenceStripResult {
  const trimmed = raw.trim();
  try {
    JSON.parse(trimmed);
    return { text: trimmed, fenceStripped: false };
  } catch {
    // fall through — not already-valid JSON.
  }

  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const fenceInner = fenceMatch?.[1]?.trim();
  if (fenceInner !== undefined) {
    try {
      JSON.parse(fenceInner);
      return { text: fenceInner, fenceStripped: true };
    } catch {
      // fall through — fenced, but not itself bare JSON (e.g. still has stray prose inside).
    }
  }

  const candidate = fenceInner ?? trimmed;
  const extracted = extractFirstJsonObject(candidate);
  if (extracted !== undefined) {
    try {
      JSON.parse(extracted);
      return { text: extracted, fenceStripped: true };
    } catch {
      // fall through
    }
  }

  return { text: trimmed, fenceStripped: false };
}

export interface NormalizeResult {
  readonly value: unknown;
  /** Plain-language, one entry per kind of change actually made — never per-line noise beyond what a cook needs (e.g. one summary line for "N ingredient units weren't recognised", not N separate lines). Empty when nothing needed fixing. */
  readonly coercions: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecognisedUnit(value: unknown): value is EntryUnit {
  return typeof value === "string" && RECIPE_IMPORT_ENTRY_UNITS.includes(value as EntryUnit);
}

/**
 * Reshapes one ingredient line: an out-of-enum unit (`"cloves"`, `"bunch"`)
 * is coerced to `null`, with the original word folded into `note` — exactly
 * what `RECIPE_IMPORT_SYSTEM_PROMPT` already asks the model to do itself
 * when an amount has no clear unit, so this is completing the model's own
 * stated convention, not inventing a new one. A `note` of `null`/`undefined`
 * becomes `""` (the schema requires a string) — but only once, after any
 * unit-word has already had first claim on it.
 */
function normalizeIngredientLine(raw: unknown): { readonly line: unknown; readonly unitCoerced: boolean; readonly noteCoerced: boolean } {
  if (!isPlainObject(raw)) return { line: raw, unitCoerced: false, noteCoerced: false };
  const line = { ...raw };
  let unitCoerced = false;
  let noteCoerced = false;

  if (typeof line.unit === "string" && !isRecognisedUnit(line.unit)) {
    const originalUnit = line.unit;
    const existingNote = typeof line.note === "string" ? line.note.trim() : "";
    line.note = existingNote === "" ? originalUnit : `${existingNote} (${originalUnit})`;
    line.unit = null;
    unitCoerced = true;
  }

  if (line.note === null || line.note === undefined) {
    line.note = "";
    noteCoerced = true;
  }

  return { line, unitCoerced, noteCoerced };
}

/** A step given as a bare string ("Wash and dry the eggplant…") becomes `{ description: "..." }` — the shape the schema actually asks for. An object already carrying `description` is left untouched; one missing `description` but carrying an obvious alias (`text`/`instruction`/`step`) is repaired the same way as the top-level `title`→`name` alias below. */
function normalizeStep(raw: unknown): { readonly step: unknown; readonly coerced: boolean } {
  if (typeof raw === "string") return { step: { description: raw }, coerced: true };
  if (!isPlainObject(raw)) return { step: raw, coerced: false };
  if (typeof raw.description === "string") return { step: raw, coerced: false };
  const alias = raw.text ?? raw.instruction ?? raw.step;
  if (typeof alias === "string") return { step: { ...raw, description: alias }, coerced: true };
  return { step: raw, coerced: false };
}

/** The three top-level numeric fields the schema requires present-but-nullable — `null` is a legitimate answer ("prep time wasn't stated"), but a field genuinely absent from the reply (not even a `null` key) is a stricter-than-null divergence some endpoints drop rather than send. Missing here is folded to `null`, same meaning the model would have expressed by sending it explicitly. */
const NULLABLE_TOP_LEVEL_FIELDS = ["servings", "prepMinutes", "cookMinutes"] as const;

/**
 * Reshapes one already-parsed-as-JSON payload into the exact shape
 * `validateRecipeImportResponse` expects, wherever the divergence is one of
 * a small, deliberately conservative set: a `title`/`name` key alias, a
 * missing (not merely null) `servings`/`prepMinutes`/`cookMinutes` key, a
 * `steps` array of plain strings (or objects using an obvious alias for
 * `description`), an ingredient `unit` outside our enum, and a `null`
 * ingredient `note`. Never touches `isRecipe`, never invents an ingredient,
 * a step, or a name that isn't already present somewhere in the payload —
 * a reply that is genuinely not a recipe, or is missing real content, still
 * fails validation afterwards exactly as it did before this function
 * existed.
 */
export function normalizeRecipeImportPayload(raw: unknown): NormalizeResult {
  if (!isPlainObject(raw)) return { value: raw, coercions: [] };
  const value: Record<string, unknown> = { ...raw };
  const coercions: string[] = [];

  if (typeof value.name !== "string" && typeof value.title === "string") {
    value.name = value.title;
    coercions.push('Used the reply\'s "title" as the recipe name — the requested field was "name".');
  }

  const missingFields = NULLABLE_TOP_LEVEL_FIELDS.filter((field) => !(field in value));
  for (const field of missingFields) value[field] = null;
  if (missingFields.length > 0) {
    coercions.push(`${missingFields.join(", ")} ${missingFields.length === 1 ? "wasn't" : "weren't"} in the reply at all — left blank rather than guessed.`);
  }

  if (Array.isArray(value.steps)) {
    let stepsCoerced = false;
    value.steps = value.steps.map((rawStep) => {
      const { step, coerced } = normalizeStep(rawStep);
      if (coerced) stepsCoerced = true;
      return step;
    });
    if (stepsCoerced) {
      coercions.push("Steps came back as plain lines of text rather than objects — each was wrapped as its own step.");
    }
  }

  if (Array.isArray(value.ingredients)) {
    let unitsCoerced = 0;
    let notesCoerced = 0;
    value.ingredients = value.ingredients.map((rawLine) => {
      const { line, unitCoerced, noteCoerced } = normalizeIngredientLine(rawLine);
      if (unitCoerced) unitsCoerced += 1;
      if (noteCoerced) notesCoerced += 1;
      return line;
    });
    if (unitsCoerced > 0) {
      coercions.push(
        `${unitsCoerced} ingredient ${unitsCoerced === 1 ? "unit wasn't" : "units weren't"} one Feeder recognises — kept the original word${unitsCoerced === 1 ? "" : "s"} as a note instead of dropping ${unitsCoerced === 1 ? "it" : "them"}.`,
      );
    }
    if (notesCoerced > 0) {
      coercions.push(`${notesCoerced} ingredient ${notesCoerced === 1 ? "note was" : "notes were"} missing and left blank.`);
    }
  }

  return { value, coercions };
}
