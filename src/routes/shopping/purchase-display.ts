/**
 * Purchasability display helpers (WP-PURCHASING — DESIGN_PURCHASING.md §6).
 * Pure formatting only, feature-scoped (not the src/ui kit, UI_DESIGN.md
 * §7) — mirrors how `categories.ts`/`range.ts` already sit beside
 * `Shopping.tsx` for the same reason.
 */
import { formatQuantity, type Ingredient, type Quantity, type ShoppingListLine } from "../../domain/index.ts";

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
