/**
 * Purchasability display helpers (WP-PURCHASING — DESIGN_PURCHASING.md §6).
 * Pure formatting only, feature-scoped (not the src/ui kit, UI_DESIGN.md
 * §7) — mirrors how `categories.ts`/`range.ts` already sit beside
 * `Shopping.tsx` for the same reason.
 */
import {
  formatQuantity,
  type Ingredient,
  type PurchaseSuggestion,
  type Quantity,
  type ShoppingListLine,
} from "../../domain/index.ts";

/** The amount that goes in the basket: the household's own override wins, else the engine's suggestion, else (defensively) the raw need. */
export function buyQuantity(line: ShoppingListLine): Quantity {
  return line.purchaseOverride ?? line.suggestedPurchase ?? line.neededQuantity;
}

export function isAdjusted(line: ShoppingListLine): boolean {
  return line.purchaseOverride !== undefined;
}

/** True once the buy amount differs from the raw need — rounding or an override, either way "the buy is not the need" (§2/§6). */
export function isRoundedOrAdjusted(line: ShoppingListLine): boolean {
  const buy = buyQuantity(line);
  return buy.amount !== line.neededQuantity.amount;
}

/** Trims to at most 2 decimals without a trailing ".00" — same rule `provenance.ts`'s `formatAmount` uses. */
function trimAmount(amount: number): string {
  return Number(amount.toFixed(2)).toString();
}

/**
 * The buy-primary number for a row (§6: "the buy amount is the primary
 * number"). `piece`/`portion` ingredients show a bare count — "2", "1" — the
 * way a person actually reads "2 onions" or "1 lasagna" off a list; `g`/`ml`
 * ingredients keep their unit ("500 g").
 */
export function formatAmountForUnit(quantity: Quantity, ingredient: Ingredient): string {
  if (ingredient.unit === "piece" || ingredient.unit === "portion") {
    return trimAmount(quantity.amount);
  }
  return formatQuantity(quantity);
}

/** A sensible loose-mode step when the ingredient has no explicit `roundTo` — the adjust stepper still needs *some* increment (§6 scenario 9). */
export function defaultLooseStep(ingredient: Ingredient): number {
  if (ingredient.roundTo && ingredient.roundTo > 0) return ingredient.roundTo;
  return ingredient.unit === "g" || ingredient.unit === "ml" ? 50 : 1;
}

/**
 * The buy-primary number, `Ingredient.packLabel`-aware (WP-purchasing-editor
 * — DESIGN_PURCHASING.md §6's "1 jar", the mock's own shopping-row example).
 * `quantity` must be a `mode: "whole"` amount rounded to `suggestion`'s pack
 * — i.e. an exact multiple of `suggestion.packSize`, which every caller here
 * (the buy amount, a household override snapped to the same pack step by the
 * adjust stepper) already is. Falls back to `formatAmountForUnit` whenever
 * `packLabel` is unset, the mode isn't `"whole"`, or the amount isn't a clean
 * multiple of the pack (a household override that deliberately ignores
 * rounding) — "most ingredients will never have one" (types.ts's own doc
 * comment on the field) must degrade to exactly today's display, never a
 * broken or nonsensical unit count.
 */
export function formatBuyPrimary(quantity: Quantity, ingredient: Ingredient, suggestion: PurchaseSuggestion): string {
  if (ingredient.packLabel && suggestion.mode === "whole" && suggestion.packSize && suggestion.packSize.amount > 0) {
    const rawUnits = quantity.amount / suggestion.packSize.amount;
    const units = Math.round(rawUnits * 1e6) / 1e6;
    if (Number.isInteger(units) && units > 0) {
      return `${units} ${ingredient.packLabel}${units === 1 ? "" : "s"}`;
    }
  }
  return formatAmountForUnit(quantity, ingredient);
}
