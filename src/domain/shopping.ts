/**
 * Shopping engine — WP-14 public entry point.
 *
 * Composes `computeNeeds` (shopping-needs.ts) and `allocateShoppingList`
 * (shopping-allocate.ts) into the one function most callers (WP-23) need:
 * needs minus viable stock, for a date range, in one pass. Multi-week
 * ("monthly") ranges go through this exact same code path as a single week
 * — `range` is just two `IsoDate`s, nothing here special-cases its span.
 *
 * Re-exports the computed types and `checkOffShoppingItem` too, so WP-23
 * can do `import { computeShoppingList, checkOffShoppingItem, ... } from
 * "<path>/domain/shopping.ts"` (or via the `src/domain` barrel) without
 * reaching into the individual shopping-*.ts files.
 */
import type { Ingredient, Lot, PlanSlot, Recipe, RecipeIngredient, Settings } from "./types.ts";
import { computeNeeds } from "./shopping-needs.ts";
import { allocateShoppingList } from "./shopping-allocate.ts";
import type { DateRange, ShoppingListLine } from "./shopping-types.ts";

export type {
  CheckOffInput,
  DateRange,
  ShoppingListLine,
  ShoppingNeed,
  ShoppingNeedSource,
} from "./shopping-types.ts";
export { computeNeeds } from "./shopping-needs.ts";
export { allocateShoppingList } from "./shopping-allocate.ts";
export { checkOffShoppingItem } from "./shopping-checkoff.ts";

export interface ShoppingEngineInputs {
  readonly range: DateRange;
  readonly planSlots: readonly PlanSlot[];
  readonly recipes: readonly Recipe[];
  readonly recipeIngredients: readonly RecipeIngredient[];
  readonly settings: Settings;
  readonly lots: readonly Lot[];
  /**
   * WP-PURCHASING, optional (additive — every pre-existing caller/test still
   * compiles without it, just without `suggestedPurchase` on the result —
   * see `allocateShoppingList`'s own doc comment). The ingredient catalog
   * `suggestPurchase` needs to know each line's purchase mode/pack size.
   */
  readonly ingredients?: readonly Ingredient[];
}

/**
 * The full "needs minus viable stock" computation for one date range
 * (DESIGN.md §2 "Shopping list"). Grouped by ingredient, FIFO-allocated
 * against viable stock, with per-meal provenance on every line.
 */
export function computeShoppingList(inputs: ShoppingEngineInputs): readonly ShoppingListLine[] {
  const needs = computeNeeds(
    inputs.range,
    inputs.planSlots,
    inputs.recipes,
    inputs.recipeIngredients,
    inputs.settings,
  );
  return allocateShoppingList(needs, inputs.lots, inputs.range, inputs.ingredients);
}
