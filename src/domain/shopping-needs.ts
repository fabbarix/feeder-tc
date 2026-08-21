/**
 * Needs aggregation — WP-14, scope item 1: "needs aggregation across a date
 * range of PlanSlots (scaled, leftovers-slots excluded)".
 *
 * Pure: no I/O, no Clock/Rng needed (dates come from the range/PlanSlots
 * themselves, not the wall clock).
 */
import type { PlanSlot, Recipe, RecipeId, RecipeIngredient, Settings } from "./types.ts";
import { makeQuantity } from "./types.ts";
import { isOnOrAfter } from "./dates.ts";
import { isIndivisible, scaleIndivisible } from "./purchasing.ts";
import type { DateRange, ShoppingNeed } from "./shopping-types.ts";

function withinRange(date: PlanSlot["date"], range: DateRange): boolean {
  return isOnOrAfter(date, range.start) && isOnOrAfter(range.end, date);
}

/**
 * Scale factor for a slot's recipe: the per-slot `scaleServings` override
 * wins over `Settings.householdSize` (DESIGN.md §2 "Servings, scaling &
 * leftovers"); the recipe's own `baseServings` is the denominator.
 *
 * WP-PURCHASING (DESIGN_PURCHASING.md §4): for an indivisible recipe (a
 * bought meal, or `indivisible: true`), the raw fractional factor is exactly
 * the bug — a lasagna serving 4 scaled to a household of 2 must need ONE
 * whole lasagna, not half of one. `scaleIndivisible`'s whole-unit count
 * (never the raw `targetServings / baseServings`) is used as the factor
 * instead, so the ingredient line for a bought meal's single product
 * ingredient already comes out as a whole, purchasable amount before it
 * ever reaches the shopping engine's general rounding stage.
 */
function scaleFactor(recipe: Recipe, scaleServings: number | undefined, settings: Settings): number {
  if (recipe.baseServings <= 0) {
    throw new Error(`Recipe ${recipe.id} has non-positive baseServings (${recipe.baseServings})`);
  }
  const targetServings = scaleServings ?? settings.householdSize;
  if (isIndivisible(recipe)) {
    return scaleIndivisible(recipe, targetServings).units;
  }
  return targetServings / recipe.baseServings;
}

/**
 * Expands every in-range `PlanSlot` into one `ShoppingNeed` per ingredient
 * line of its recipe, scaled to the slot's target servings.
 *
 * - `filling.kind === "leftover"` and `"empty"` slots contribute nothing —
 *   the three-way union forces this `switch` to handle both explicitly
 *   rather than falling through a null check (BDD: "Leftover slots generate
 *   no needs").
 * - A `"skipped"` slot (the meal isn't happening) likewise contributes
 *   nothing; `"planned"` and `"cooked"` slots in range both do — a cooked
 *   slot still represents a meal that was eaten within the range and whose
 *   ingredients are part of what the range needed.
 * - Referential integrity (a slot's `recipeId` must resolve, a recipe must
 *   have positive `baseServings`) is assumed of already-decoded entities —
 *   this engine throws on violation rather than silently under-counting,
 *   matching how `quantity.ts`/`types.ts` validating constructors treat
 *   invalid input as a caller bug, not a data-quality warning (that's the
 *   codec layer's job, upstream of this engine).
 */
export function computeNeeds(
  range: DateRange,
  planSlots: readonly PlanSlot[],
  recipes: readonly Recipe[],
  recipeIngredients: readonly RecipeIngredient[],
  settings: Settings,
): readonly ShoppingNeed[] {
  const recipeById = new Map<RecipeId, Recipe>(recipes.map((r) => [r.id, r]));
  const linesByRecipe = new Map<RecipeId, RecipeIngredient[]>();
  for (const line of recipeIngredients) {
    const existing = linesByRecipe.get(line.recipeId);
    if (existing) {
      existing.push(line);
    } else {
      linesByRecipe.set(line.recipeId, [line]);
    }
  }

  const needs: ShoppingNeed[] = [];

  for (const slot of planSlots) {
    if (slot.state === "skipped") continue;
    if (!withinRange(slot.date, range)) continue;

    switch (slot.filling.kind) {
      case "leftover":
      case "empty":
        continue;
      case "recipe": {
        const recipeId = slot.filling.recipeId;
        const recipe = recipeById.get(recipeId);
        if (!recipe) {
          throw new Error(`PlanSlot ${slot.id} references unknown recipe ${recipeId}`);
        }
        const factor = scaleFactor(recipe, slot.filling.scaleServings, settings);
        const lines = linesByRecipe.get(recipeId) ?? [];
        for (const line of lines) {
          needs.push({
            ingredientId: line.ingredientId,
            quantity: makeQuantity(line.quantity.amount * factor, line.quantity.unit),
            source: {
              planSlotId: slot.id,
              date: slot.date,
              slotType: slot.slotType,
              slotIndex: slot.slotIndex,
              recipeId,
            },
          });
        }
        break;
      }
    }
  }

  return needs;
}
