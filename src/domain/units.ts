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
 */
export function convertEntryToCanonical(entered: EnteredQuantity, canonicalUnit: Unit): Quantity {
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
  if (dimension !== canonicalDimension) {
    throw new Error(
      `Cannot convert "${entered.unit}" (${dimension}) into canonical unit "${canonicalUnit}" (${canonicalDimension}) — mass and volume are not interchangeable.`,
    );
  }

  return makeQuantity(amount, canonicalUnit);
}
