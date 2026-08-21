/**
 * Purchasability engine — WP-PURCHASING (DESIGN_PURCHASING.md), fixing the
 * live defect: a bought lasagna serving 4, in a household of 2, showing on
 * the shopping list as "0.5 Store Bought Lasagna."
 *
 * Two pure functions, no I/O, same shape as every other engine in this
 * directory:
 *
 *  - `suggestPurchase` turns a *need* (what the recipes require, which stays
 *    fractional — §2) into a *buy* (what goes in the basket, which never
 *    is). Called exactly ONCE per ingredient, on the already-aggregated,
 *    post-FIFO shortfall (§2.1 — see `shopping-allocate.ts`'s call site).
 *  - `scaleIndivisible` computes how many whole units of an indivisible
 *    recipe (`kind === "bought"`, or `indivisible: true` — §4) a target
 *    servings count requires, and how many servings that produces — the
 *    honest fix for symptom 1, used by `computeNeeds` (shopping-needs.ts)
 *    in place of the raw `targetServings / baseServings` scale factor for
 *    exactly those recipes.
 *
 * Neither function converts units (invariant 3) — both operate entirely in
 * whatever canonical unit the caller already supplies; `units.ts` is never
 * imported here (and lint would refuse it — see eslint.config.js).
 */
import type { Ingredient, Product, Quantity, Recipe } from "./types.ts";
import { makeQuantity } from "./types.ts";
import { assertSameUnit } from "./quantity.ts";

export type PurchaseMode = "whole" | "loose";

/**
 * §3's zero-migration defaults, derived from the ingredient's existing
 * `unit` when `purchaseMode` isn't set explicitly: `piece`/`portion` ->
 * `whole` (a jar, an onion, a leftover portion is already a whole unit),
 * `g`/`ml` -> `loose` (exactly today's behaviour — nothing regresses).
 */
export function defaultPurchaseMode(ingredient: Ingredient): PurchaseMode {
  if (ingredient.purchaseMode) return ingredient.purchaseMode;
  return ingredient.unit === "piece" || ingredient.unit === "portion" ? "whole" : "loose";
}

/**
 * The typical pack for a `"whole"`-mode ingredient: a specific `Product`'s
 * `canonicalQuantity` overrides the ingredient's own `packSize` (§3 — "the
 * ingredient-level pack is the *typical* case; the product is the *actual*
 * one"); absent both, one bare unit is the pack (the `piece`/`portion`
 * default needs no data entry at all).
 */
function effectivePackSize(ingredient: Ingredient, product?: Product): Quantity {
  if (product) return product.canonicalQuantity;
  if (ingredient.packSize) return ingredient.packSize;
  return makeQuantity(1, ingredient.unit);
}

/** Clamps float noise from repeated multiplication/division (e.g. `0.1 * 3` -> `0.30000000000000004`) without losing genuine sub-integer precision. */
function roundFloat(amount: number): number {
  return Math.round(amount * 1e9) / 1e9;
}

export interface PurchaseSuggestion {
  /** What to buy, in the ingredient's canonical unit. Never fractional for `mode: "whole"`. */
  readonly quantity: Quantity;
  readonly mode: PurchaseMode;
  /** The pack used to round, for `mode: "whole"` only (product override or ingredient typical, §3). */
  readonly packSize?: Quantity;
  /** Whole packs bought, for `mode: "whole"` only. */
  readonly units?: number;
  /** `quantity - need`, same unit. Always >= 0 — surplus is normal, never negative (§6: "no new alarm colours"). */
  readonly surplus: Quantity;
}

/**
 * Rounds one ingredient's aggregated, post-FIFO shortfall into something a
 * household can actually put in a basket (§2/§3). `need` and `ingredient`
 * must share a unit — the same invariant-3 guard every other engine in this
 * directory uses (`assertSameUnit`), because a mismatch here would mean a
 * caller passed the wrong ingredient for this need, a caller bug rather
 * than a data-quality warning.
 *
 * `product`, if supplied, is a specific scanned/known `Product` whose
 * `canonicalQuantity` overrides the ingredient's typical `packSize` (§3) —
 * out of scope for THIS package to wire up end-to-end (no UI here selects
 * a product for a shopping line), but the seam is real and tested.
 */
export function suggestPurchase(need: Quantity, ingredient: Ingredient, product?: Product): PurchaseSuggestion {
  assertSameUnit(need, { amount: 0, unit: ingredient.unit }, `suggestPurchase: need vs ${ingredient.id}`);

  const mode = defaultPurchaseMode(ingredient);

  if (mode === "whole") {
    const packSize = effectivePackSize(ingredient, product);
    if (packSize.amount <= 0) {
      throw new Error(`packSize for "${ingredient.id}" must be positive, got ${packSize.amount}`);
    }
    const units = Math.max(0, Math.ceil(roundFloat(need.amount / packSize.amount) - 1e-9));
    const boughtAmount = roundFloat(units * packSize.amount);
    return {
      quantity: makeQuantity(boughtAmount, ingredient.unit),
      mode,
      packSize,
      units,
      surplus: makeQuantity(roundFloat(Math.max(0, boughtAmount - need.amount)), ingredient.unit),
    };
  }

  // "loose": buy = need, optionally rounded up to `roundTo` (§9.4/§11.3 — deferred but free).
  let boughtAmount = need.amount;
  if (ingredient.roundTo && ingredient.roundTo > 0) {
    boughtAmount = roundFloat(Math.ceil(roundFloat(need.amount / ingredient.roundTo) - 1e-9) * ingredient.roundTo);
  }
  return {
    quantity: makeQuantity(boughtAmount, ingredient.unit),
    mode,
    surplus: makeQuantity(roundFloat(Math.max(0, boughtAmount - need.amount)), ingredient.unit),
  };
}

export interface IndivisibleScaling {
  /** Whole units of the recipe made/bought — always >= 1 for a positive `targetServings`. */
  readonly units: number;
  /** `units * baseServings` — the total servings this actually produces. */
  readonly producedServings: number;
  /** `producedServings - targetServings`, always >= 0 — the forecast leftover (§4/§9.3). */
  readonly surplusServings: number;
}

/**
 * §4's fix for symptom 1 ("bought meals are scaled like flour"): an
 * indivisible recipe (`kind === "bought"`, or `indivisible: true`) cannot
 * produce a fraction of itself, so scaling it means deciding how many
 * *whole* units to make, then accounting honestly for the yield —
 * `Lasagna, baseServings: 4, household 2 -> 1 lasagna, 4 servings produced,
 * 2 portions left over.`
 */
export function scaleIndivisible(recipe: Recipe, targetServings: number): IndivisibleScaling {
  if (recipe.baseServings <= 0) {
    throw new Error(`Recipe ${recipe.id} has non-positive baseServings (${recipe.baseServings})`);
  }
  if (!Number.isFinite(targetServings) || targetServings <= 0) {
    throw new Error(`targetServings must be a positive finite number, got ${targetServings}`);
  }
  const units = Math.ceil(roundFloat(targetServings / recipe.baseServings) - 1e-9);
  const producedServings = units * recipe.baseServings;
  return { units, producedServings, surplusServings: roundFloat(producedServings - targetServings) };
}

/** True if `recipe` cannot be subdivided when scaling — the effective (defaulted) value of `Recipe.indivisible` (§4/§8). */
export function isIndivisible(recipe: Recipe): boolean {
  return recipe.indivisible ?? recipe.kind === "bought";
}

/**
 * Merges a persisted household override (`ShoppingItem.purchaseOverride`)
 * onto a computed `ShoppingListLine` (§6 scenario 9 / §7). Deliberately a
 * plain merge, not something `allocateShoppingList` does itself — the
 * engine is pure/I-O-free and has no way to see a persisted row; the
 * caller (the Shopping route's container) reads `ShoppingItems` and calls
 * this once per line. An override survives exactly because it lives here,
 * outside the recompute: a reroll changes `neededQuantity`/
 * `suggestedPurchase`, never a choice already merged in from a separate,
 * untouched persisted row.
 */
export function withPurchaseOverride<T extends { readonly purchaseOverride?: Quantity }>(
  line: T,
  override: Quantity | undefined,
): T {
  if (override === undefined) return line;
  return { ...line, purchaseOverride: override };
}
