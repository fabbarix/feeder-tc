/**
 * Household scaling math — WP-13.
 *
 * DESIGN.md §2 "Servings, scaling & leftovers": recipes store base servings,
 * Settings stores a household size, and the planner scales ingredient
 * quantities automatically with a per-slot manual override
 * (`PlanSlotFilling.scaleServings`, contracts.ts). No unit conversion
 * anywhere (invariant 3) — scaling only ever multiplies `Quantity.amount` by
 * a factor; the unit is untouched.
 */
import { makeQuantity } from "../types.ts";
import type {
  IngredientId,
  PlanSlotFilling,
  Quantity,
  Recipe,
  RecipeIngredient,
  Settings,
} from "../types.ts";

/** `targetServings / baseServings`. Throws on a non-positive `baseServings` — a recipe can't scale from zero. */
export function servingsScaleFactor(baseServings: number, targetServings: number): number {
  if (!(baseServings > 0)) {
    throw new Error(`servingsScaleFactor: baseServings must be positive, got ${baseServings}`);
  }
  if (targetServings < 0) {
    throw new Error(`servingsScaleFactor: targetServings must be non-negative, got ${targetServings}`);
  }
  return targetServings / baseServings;
}

/** Scales a Quantity's amount by `factor`. Same unit in, same unit out — no conversion. */
export function scaleQuantity(quantity: Quantity, factor: number): Quantity {
  return makeQuantity(quantity.amount * factor, quantity.unit);
}

/**
 * The servings target a filled slot should scale to: its own
 * `scaleServings` override if set, otherwise the household size. `undefined`
 * for a `leftover`/`empty` filling — those aren't scaled recipes.
 */
export function resolveTargetServings(
  settings: Settings,
  filling: PlanSlotFilling,
): number | undefined {
  if (filling.kind !== "recipe") {
    return undefined;
  }
  return filling.scaleServings ?? settings.householdSize;
}

export interface ScaledIngredientLine {
  readonly ingredientId: IngredientId;
  readonly quantity: Quantity;
}

/**
 * A recipe's ingredient lines scaled from its base servings to
 * `targetServings`. Used by the shopping engine (WP-14) and mark-cooked flow
 * (WP-22) to turn "Chili, scaled to 8 servings" into concrete quantities.
 */
export function scaledRecipeIngredients(
  recipe: Recipe,
  recipeIngredients: readonly RecipeIngredient[],
  targetServings: number,
): readonly ScaledIngredientLine[] {
  const factor = servingsScaleFactor(recipe.baseServings, targetServings);
  return recipeIngredients
    .filter((line) => line.recipeId === recipe.id)
    .map((line) => ({
      ingredientId: line.ingredientId,
      quantity: scaleQuantity(line.quantity, factor),
    }));
}
