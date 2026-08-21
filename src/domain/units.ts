/**
 * !!! THE ONE SANCTIONED UNIT-CONVERSION MODULE IN THIS ENTIRE CODEBASE !!!
 *
 * HANDOVER.md §4 invariant 3: "One canonical unit per ingredient. No
 * conversion logic anywhere. Reject mixed-unit writes at the codec layer."
 * DESIGN_PRODUCTS.md §3 narrows that, with the product owner's explicit
 * approval (2026-08-20), to exactly one exception: the product editor may
 * convert a human-entered amount+unit into an ingredient's canonical `Unit`,
 * ONCE, at entry time, before anything is written to the workbook. That is
 * what this module is for, and the only thing it is for.
 *
 * Rules that follow from that:
 *  - This is entry-time-only. It exists to save a human from typing "454"
 *    when they mean "1 lb". It is not a general-purpose unit library.
 *  - NO engine may import this (inventory fold, planner, shopping
 *    allocator). They see only canonical `Quantity` values and must keep
 *    treating a unit mismatch as a hard error, exactly as before this
 *    module existed.
 *  - NO codec may import this. Every codec keeps rejecting mixed units at
 *    decode/write time unchanged (see e.g.
 *    src/sheets/codecs/recipe-ingredients.ts, which still throws on a unit
 *    mismatch rather than converting one).
 *  - NO sheet, fold, or other domain module converts. Ever. If you are
 *    working on a different work package and find yourself reaching for
 *    this file to convert a quantity you already have in hand (as opposed
 *    to a raw amount+unit a human just typed into a product editor), that
 *    is almost certainly invariant 3 about to be violated — stop and
 *    escalate instead of importing this.
 *
 * `eslint.config.js` enforces the "no engine/codec import" rule above at
 * lint time (a `no-restricted-imports` block scoped to src/sheets/** and
 * the engine directories under src/domain/**), so a violation fails
 * `npm run lint`, not just code review.
 */
import { makeQuantity, type EntryUnit, type Quantity, type Unit } from "./types.ts";

/** The kind of physical quantity an `EntryUnit`/canonical `Unit` measures. Mass and volume are never interchangeable. */
type Dimension = "mass" | "volume" | "count";

/** Canonical units' dimension. `portion` has none listed — it is the leftover-lot unit (DESIGN.md glossary) and is never a product's canonical unit, so it deliberately has no entry-time equivalent. */
const DIMENSION_OF_CANONICAL_UNIT: Partial<Record<Unit, Dimension>> = {
  g: "mass",
  ml: "volume",
  piece: "count",
};

export interface EnteredQuantity {
  readonly amount: number;
  readonly unit: EntryUnit;
}

/**
 * Density info for the two cross-dimension conversions DESIGN_PURCHASING.md
 * §10.1 documents (volume->mass, count->mass) — both owned by
 * `Ingredient.gramsPerMl`/`gramsPerPiece` (§10.1a/§10.3). Optional on every
 * call: when absent, a cross-dimension entry is rejected exactly as it
 * always was (see `convertEntryToCanonical`'s doc comment) rather than
 * guessed.
 */
export interface ConversionDensity {
  readonly gramsPerMl?: number;
  readonly gramsPerPiece?: number;
}

/** Every `EntryUnit`, converted to its canonical-scale amount (grams for mass, millilitres for volume, itself for count) plus which dimension it belongs to. Exhaustive over `EntryUnit` — a new entry unit is a compile error here until handled. */
function toCanonicalScale(entered: EnteredQuantity): { readonly amount: number; readonly dimension: Dimension } {
  switch (entered.unit) {
    case "kg":
      return { amount: entered.amount * 1000, dimension: "mass" };
    case "g":
      return { amount: entered.amount, dimension: "mass" };
    case "lb":
      return { amount: entered.amount * 453.59237, dimension: "mass" };
    case "oz":
      return { amount: entered.amount * 28.349523125, dimension: "mass" };
    case "l":
      return { amount: entered.amount * 1000, dimension: "volume" };
    case "ml":
      return { amount: entered.amount, dimension: "volume" };
    case "fl oz":
      // US customary fluid ounce (29.5735295625 ml) — the same fl oz the US grocery-label unit means.
      return { amount: entered.amount * 29.5735295625, dimension: "volume" };
    case "piece":
      return { amount: entered.amount, dimension: "count" };
    // DESIGN_PURCHASING.md §10.2 — the US legal set, decided 2026-08-21:
    // 1 cup = 240 ml, 1 tbsp = 15 ml, 1 tsp = 5 ml (internally consistent:
    // 1 cup = 16 tbsp = 48 tsp). Mass<->volume needs no per-ingredient data
    // (§10.1) — only *entering* a volume against a mass-canonical ingredient
    // (e.g. "1 cup flour" -> g) needs a density, handled below.
    case "cup":
      return { amount: entered.amount * 240, dimension: "volume" };
    case "tbsp":
      return { amount: entered.amount * 15, dimension: "volume" };
    case "tsp":
      return { amount: entered.amount * 5, dimension: "volume" };
  }
}

/**
 * Converts one human-entered amount+unit into `canonicalUnit`'s `Quantity`.
 * The single call site for this is the product editor (out of scope for
 * M6-A — no UI work here), turning "1 lb" into `{ amount: 453.59237, unit:
 * "g" }` once, before the product is written.
 *
 * Rejects loudly rather than guessing:
 *  - a non-positive/non-finite entered amount,
 *  - a dimension mismatch (mass entered against a volume-canonical
 *    ingredient, or vice versa — "500 g" can never satisfy an ingredient
 *    whose canonical unit is `ml`),
 *  - a canonical unit with no entry-time equivalent (`portion`).
 *
 * `density` (DESIGN_PURCHASING.md §10.1/§10.3, optional, added by
 * WP-PURCHASING) enables exactly the two cross-dimension conversions §10.1's
 * table calls out as needing per-ingredient data: entering a volume unit
 * (cup/tbsp/tsp/ml/l/fl oz) against a mass-canonical ingredient using
 * `gramsPerMl`, and entering `piece` against a mass-canonical ingredient
 * using `gramsPerPiece` ("2 onions" -> grams, once an ingredient re-units to
 * grams — §9.1). Omitting `density` (or the specific field it would need)
 * preserves the exact prior behaviour — a hard "mass and volume are not
 * interchangeable" rejection — never a guess (§10.1: "a default density of
 * 1.0 would overstate flour by ~80%").
 */
export function convertEntryToCanonical(
  entered: EnteredQuantity,
  canonicalUnit: Unit,
  density?: ConversionDensity,
): Quantity {
  if (!Number.isFinite(entered.amount) || entered.amount <= 0) {
    throw new Error(`Entered amount must be a positive finite number, got ${entered.amount}`);
  }

  const canonicalDimension = DIMENSION_OF_CANONICAL_UNIT[canonicalUnit];
  if (canonicalDimension === undefined) {
    throw new Error(
      `Canonical unit "${canonicalUnit}" has no entry-time equivalent (it is a leftover-lot-only unit, never a product's canonical unit).`,
    );
  }

  const { amount, dimension } = toCanonicalScale(entered);
  if (dimension === canonicalDimension) {
    return makeQuantity(amount, canonicalUnit);
  }

  if (canonicalDimension === "mass" && dimension === "volume" && density?.gramsPerMl !== undefined) {
    return makeQuantity(amount * density.gramsPerMl, canonicalUnit);
  }
  if (canonicalDimension === "mass" && dimension === "count" && density?.gramsPerPiece !== undefined) {
    return makeQuantity(amount * density.gramsPerPiece, canonicalUnit);
  }

  throw new Error(
    `Cannot convert "${entered.unit}" (${dimension}) into canonical unit "${canonicalUnit}" (${canonicalDimension}) — mass and volume are not interchangeable.`,
  );
}
