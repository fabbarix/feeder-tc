/**
 * Recipe import — shared response validation + ingredient matcher.
 * DESIGN_RECIPE_IMPORT.md §4/§6/§10, "Decisions (owner, 2026-08-24)" §6:
 * "One shared matcher module serves both input paths. Two implementations
 * of ingredient resolution would drift, and drift here means a wrong
 * shopping list." This module is that one implementation — the text-import
 * path (this work package) and the photo-import path
 * (DESIGN_RECIPE_IMPORT_PHOTO.md) both import it rather than each rolling
 * their own.
 *
 * Pure module: no I/O, no React, no fetch. Two independent jobs:
 *
 *  1. `validateRecipeImportResponse` — layer 1 of §10's three-layer
 *     validation ("never trust model output"). Checks a raw parsed-JSON
 *     value actually has the shape the request's `json_schema` asked for
 *     (types, required fields, the fixed `EntryUnit` enum) before anything
 *     downstream touches it. A response that fails this is an error, never
 *     a draft (§10's own words).
 *  2. `resolveImportedLine` — layer 2/the matcher itself. Matches a parsed
 *     ingredient's free-text name against the household's real
 *     `Ingredients` catalogue, reusing the confidence-banded,
 *     under-matching-biased approach `suggestProductMerges`
 *     (src/domain/products.ts) already ships for the same reason (§4: "a
 *     wrong confident match corrupting the shopping list is worse than a
 *     missed one"). Never invents an `IngredientId`; a name that doesn't
 *     match confidently enough is left for the cook to resolve by hand.
 */
import { convertEntryToCanonical, type ConversionDensity } from "../domain/units.ts";
import type { EntryUnit, Ingredient, IngredientId } from "../domain/types.ts";

/** The exact `EntryUnit` vocabulary the request schema constrains the model to (DESIGN_RECIPE_IMPORT.md §5/§6) — never widened ad hoc. */
export const RECIPE_IMPORT_ENTRY_UNITS: readonly EntryUnit[] = [
  "kg",
  "g",
  "lb",
  "oz",
  "l",
  "ml",
  "fl oz",
  "piece",
  "cup",
  "tbsp",
  "tsp",
];

export interface ParsedIngredientLine {
  readonly name: string;
  readonly amount: number | null;
  readonly unit: EntryUnit | null;
  /** Free text for anything the amount/unit fields couldn't carry ("a pinch", "to taste", "minced") — never parsed further. */
  readonly note: string;
}

export interface ParsedRecipeStep {
  readonly description: string;
}

export interface ParsedRecipeDraft {
  readonly isRecipe: boolean;
  readonly name: string;
  readonly servings: number | null;
  readonly prepMinutes: number | null;
  readonly cookMinutes: number | null;
  readonly ingredients: readonly ParsedIngredientLine[];
  readonly steps: readonly ParsedRecipeStep[];
}

export type RecipeImportValidation =
  | { readonly ok: true; readonly draft: ParsedRecipeDraft }
  | {
      readonly ok: false;
      readonly reason: string;
      /**
       * Structured detail for the diagnostic panel
       * (`diagnostics.ts`'s `ImportValidationDetail`) — "which field, what
       * was expected, what arrived" (owner's requirement). Optional: the
       * two branches with their own distinct headline (not-a-recipe, no
       * ingredients) don't need a field/expected/received breakdown to be
       * told apart, so they omit this rather than inventing one.
       */
      readonly field?: string;
      readonly expected?: string;
      readonly received?: string;
    };

function isEntryUnit(value: unknown): value is EntryUnit {
  return typeof value === "string" && RECIPE_IMPORT_ENTRY_UNITS.includes(value as EntryUnit);
}

function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

/** A short, safe-to-display description of whatever a field actually held — for the diagnostic panel's "what arrived" line. Never dumps an arbitrarily large object; a string/number/boolean shows its literal value, anything else shows only its shape. */
function describeReceived(value: unknown): string {
  if (value === undefined) return "(missing)";
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 80 ? `"${value.slice(0, 80)}…"` : `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === "object") return "an object";
  return typeof value;
}

function validateIngredientLine(raw: unknown, index: number): ParsedIngredientLine | { reason: string } {
  if (typeof raw !== "object" || raw === null) return { reason: `ingredient ${index + 1} is not an object` };
  const line = raw as Record<string, unknown>;
  if (typeof line.name !== "string" || line.name.trim() === "") {
    return { reason: `ingredient ${index + 1} has no name` };
  }
  if (!isFiniteOrNull(line.amount)) return { reason: `ingredient ${index + 1} has a non-numeric amount` };
  if (line.unit !== null && !isEntryUnit(line.unit)) {
    return { reason: `ingredient ${index + 1} has an unrecognised unit` };
  }
  if (typeof line.note !== "string") return { reason: `ingredient ${index + 1} has a malformed note` };
  return { name: line.name.trim(), amount: line.amount, unit: line.unit, note: line.note };
}

function validateStep(raw: unknown, index: number): ParsedRecipeStep | { reason: string } {
  if (typeof raw !== "object" || raw === null) return { reason: `step ${index + 1} is not an object` };
  const step = raw as Record<string, unknown>;
  if (typeof step.description !== "string" || step.description.trim() === "") {
    return { reason: `step ${index + 1} has no description` };
  }
  return { description: step.description.trim() };
}

/**
 * Validates a raw parsed-JSON value against the recipe-import response
 * shape (DESIGN_RECIPE_IMPORT.md §6's schema) — malformed JSON, a wrong
 * shape, or `isRecipe: false` all fail here, before anything reaches the
 * review screen (§10's table: "Page wasn't a recipe at all" / caught by
 * `isRecipe: false`).
 */
export function validateRecipeImportResponse(raw: unknown): RecipeImportValidation {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "The response wasn't a recognisable shape." };
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.isRecipe !== "boolean") {
    return {
      ok: false,
      reason: "The response was missing whether this was even a recipe.",
      field: "isRecipe",
      expected: "boolean",
      received: describeReceived(value.isRecipe),
    };
  }
  if (!value.isRecipe) {
    return { ok: false, reason: "That doesn't look like a recipe — try pasting just the ingredients and steps." };
  }
  if (typeof value.name !== "string" || value.name.trim() === "") {
    return {
      ok: false,
      reason: "The response had no recipe name.",
      field: "name",
      expected: "a non-empty string",
      received: describeReceived(value.name),
    };
  }
  if (!isFiniteOrNull(value.servings)) {
    return {
      ok: false,
      reason: "The response had a servings value that wasn't a number.",
      field: "servings",
      expected: "a number or null",
      received: describeReceived(value.servings),
    };
  }
  if (!isFiniteOrNull(value.prepMinutes)) {
    return {
      ok: false,
      reason: "The response had a prep time that wasn't a number.",
      field: "prepMinutes",
      expected: "a number or null",
      received: describeReceived(value.prepMinutes),
    };
  }
  if (!isFiniteOrNull(value.cookMinutes)) {
    return {
      ok: false,
      reason: "The response had a cook time that wasn't a number.",
      field: "cookMinutes",
      expected: "a number or null",
      received: describeReceived(value.cookMinutes),
    };
  }
  if (!Array.isArray(value.ingredients)) {
    return {
      ok: false,
      reason: "The response had no ingredient list.",
      field: "ingredients",
      expected: "an array",
      received: describeReceived(value.ingredients),
    };
  }
  if (!Array.isArray(value.steps)) {
    return {
      ok: false,
      reason: "The response had no steps.",
      field: "steps",
      expected: "an array",
      received: describeReceived(value.steps),
    };
  }

  const ingredients: ParsedIngredientLine[] = [];
  for (const [index, rawLine] of value.ingredients.entries()) {
    const result = validateIngredientLine(rawLine, index);
    if ("reason" in result) {
      return {
        ok: false,
        reason: `The response wasn't usable: ${result.reason}.`,
        field: `ingredients[${index}]`,
        received: describeReceived(rawLine),
      };
    }
    ingredients.push(result);
  }

  // A distinct cause from "malformed ingredient list" — the reply was
  // shaped correctly, JSON-valid, and every line would have parsed fine,
  // there just weren't any (the owner's report names this explicitly:
  // "returned a recipe with no ingredients" is a different problem from
  // any of the shape failures above, and must read as one on the
  // diagnostic panel even though `error-messages.ts` gives it the same
  // plain headline as any other invalid-response).
  if (ingredients.length === 0) {
    return { ok: false, reason: "The response listed no ingredients at all." };
  }

  const steps: ParsedRecipeStep[] = [];
  for (const [index, rawStep] of value.steps.entries()) {
    const result = validateStep(rawStep, index);
    if ("reason" in result) {
      return {
        ok: false,
        reason: `The response wasn't usable: ${result.reason}.`,
        field: `steps[${index}]`,
        received: describeReceived(rawStep),
      };
    }
    steps.push(result);
  }

  return {
    ok: true,
    draft: {
      isRecipe: true,
      name: value.name.trim(),
      servings: value.servings,
      prepMinutes: value.prepMinutes,
      cookMinutes: value.cookMinutes,
      ingredients,
      steps,
    },
  };
}

// ---------------------------------------------------------------------------
// Ingredient-name matching — mirrors products.ts's `suggestProductMerges`
// approach (token-Jaccard over normalized names) without importing its
// internals, since that module's helpers are scoped to product-pair
// matching, not free-text-against-catalogue lookup. Deliberately its own
// small pure functions rather than a shared "string similarity" utility —
// the two problems (are these two PRODUCTS the same? does this NAME belong
// to this INGREDIENT?) have different enough shapes that a forced-shared
// helper would need its own set of knobs anyway.
// ---------------------------------------------------------------------------

function normalizeIngredientName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nameTokens(name: string): ReadonlySet<string> {
  const normalized = normalizeIngredientName(name);
  return new Set(normalized.length === 0 ? [] : normalized.split(" "));
}

function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * How confident a match has to be before it pre-fills a line unattended.
 * Deliberately higher than `suggestProductMerges`'s 0.5 "worth asking about"
 * floor: a product-merge suggestion is always confirmed by a human before
 * anything changes, but an import match pre-fills the review screen's
 * ingredient picker directly (still editable, but visibly a fill-in — see
 * `ResolvedIngredientLine.matched`). DESIGN_RECIPE_IMPORT.md §4: "near-exact
 * name match... high confidence"; the under-matching bias for import lands
 * here instead — a middling score leaves the line blank rather than risking
 * a plausible-but-wrong pre-fill the cook skims past.
 */
const NAME_MATCH_THRESHOLD = 0.8;

/** Exact match after normalization (e.g. "Garlic" / "garlic cloves" both normalize the same only if identical post-normalize) or Jaccard similarity at/above the threshold. `undefined` when nothing in the catalogue is a confident match. */
export function matchIngredientName(name: string, catalogue: readonly Ingredient[]): Ingredient | undefined {
  const normalizedTarget = normalizeIngredientName(name);
  if (normalizedTarget === "") return undefined;

  const exact = catalogue.find((ingredient) => normalizeIngredientName(ingredient.name) === normalizedTarget);
  if (exact) return exact;

  const targetTokens = nameTokens(name);
  let best: { ingredient: Ingredient; score: number } | undefined;
  for (const ingredient of catalogue) {
    const score = jaccardSimilarity(targetTokens, nameTokens(ingredient.name));
    if (score >= NAME_MATCH_THRESHOLD && (best === undefined || score > best.score)) {
      best = { ingredient, score };
    }
  }
  return best?.ingredient;
}

export interface ResolvedIngredientLine {
  readonly key: string;
  /** The name exactly as the model returned it — always shown, matched or not, so the cook can compare against the pasted text. */
  readonly rawName: string;
  readonly rawNote: string;
  /** `null` until the cook picks one, unless matching pre-filled it. */
  readonly ingredientId: IngredientId | null;
  /** True only when this line was pre-filled by a confident match — the review screen must show this distinctly from a line the cook picked themselves (DESIGN_RECIPE_IMPORT.md §4/§11: "never implying more certainty than it has"). */
  readonly matched: boolean;
  readonly amount: number | null;
  readonly entryUnit: EntryUnit | null;
  /**
   * Set when the model returned an amount+unit that could not be converted
   * against a matched ingredient's canonical unit (no density set — §5:
   * "never guess a density"). When set, `ingredientId` is deliberately left
   * `null` even though a name match existed, so the cook must either pick a
   * different ingredient or set this one's density and re-import — never a
   * silently wrong pre-fill.
   */
  readonly conversionNote?: string;
}

function densityOf(ingredient: Ingredient): ConversionDensity {
  return {
    ...(ingredient.gramsPerMl !== undefined ? { gramsPerMl: ingredient.gramsPerMl } : {}),
    ...(ingredient.gramsPerPiece !== undefined ? { gramsPerPiece: ingredient.gramsPerPiece } : {}),
  };
}

/** Whether `amount unit` can convert into `ingredient`'s canonical unit at all, without actually needing the result — a pure "would this line be enterable" check reused by both branches below. */
function canConvertToIngredient(amount: number, unit: EntryUnit, ingredient: Ingredient): boolean {
  const canonicalUnit = ingredient.unit === "portion" ? "g" : ingredient.unit;
  try {
    convertEntryToCanonical({ amount, unit }, canonicalUnit, densityOf(ingredient));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves one parsed ingredient line against the household's catalogue —
 * the matcher's main entry point. Never throws: an unconvertible or
 * unmatched line comes back with `ingredientId: null` for the cook to
 * resolve on the review screen (DESIGN_RECIPE_IMPORT.md §10, "nothing is
 * written until a person reviews it").
 */
export function resolveImportedLine(line: ParsedIngredientLine, catalogue: readonly Ingredient[], key: string): ResolvedIngredientLine {
  const match = matchIngredientName(line.name, catalogue);
  const base = { key, rawName: line.name, rawNote: line.note };

  if (!match) {
    return { ...base, ingredientId: null, matched: false, amount: line.amount, entryUnit: line.unit };
  }

  if (line.amount === null || line.unit === null) {
    // Nothing to convert (e.g. "salt, to taste") — the match still pre-fills the ingredient.
    return { ...base, ingredientId: match.id, matched: true, amount: line.amount, entryUnit: line.unit };
  }

  if (canConvertToIngredient(line.amount, line.unit, match)) {
    return { ...base, ingredientId: match.id, matched: true, amount: line.amount, entryUnit: line.unit };
  }

  return {
    ...base,
    ingredientId: null,
    matched: false,
    amount: line.amount,
    entryUnit: line.unit,
    conversionNote: `Read as "${line.amount} ${line.unit} ${line.name}" — "${match.name}" doesn't have enough information to convert that unit, so pick an ingredient and enter this by hand.`,
  };
}

/** Resolves every ingredient line in a draft in order, minting a stable local `key` for each (matches `RecipeEditor`'s own `LineDraft.key` convention). */
export function resolveImportedLines(
  lines: readonly ParsedIngredientLine[],
  catalogue: readonly Ingredient[],
): readonly ResolvedIngredientLine[] {
  return lines.map((line, index) => resolveImportedLine(line, catalogue, `imported-${index}`));
}
