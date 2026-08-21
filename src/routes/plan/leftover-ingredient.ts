/**
 * Resolves (or creates) the catalog `Ingredient` representing "Leftover:
 * <recipe>" for a cooked recipe's surplus servings (DESIGN.md §2 "Servings,
 * scaling & leftovers" — `createLeftoverLot`, src/domain/inventory/leftovers.ts,
 * only knows the `IngredientId` already resolved for that entry).
 *
 * Same shape as `RecipeEditor.tsx`'s bought-meal product ingredient, with
 * one deliberate difference: the id is a DETERMINISTIC slug
 * (`leftover-<recipe-slug>`), not `uniqueSlug`'s random-suffix-on-collision
 * scheme. A bought-meal product is created once, at recipe-save time, so a
 * collision there means two different recipes happen to share a name and
 * genuinely need distinct ids. A leftover ingredient is instead resolved
 * every time ANY slot of that recipe is marked cooked — the same recipe
 * cooked five times must resolve to the SAME leftover ingredient each time
 * (`WorkbookStore.ingredients.upsert` is insert-or-replace by id, so
 * calling this twice for "Chili" is idempotent), not five distinct rows
 * named "Leftover: Chili".
 */
import { slugify } from "../slug.ts";
import type { Ingredient, IngredientId, Recipe, StorageLocation } from "../../domain/index.ts";
import { makeIngredientId } from "../../domain/index.ts";
import { LEFTOVER_DEFAULT_LOCATION, LEFTOVER_FRIDGE_SHELF_LIFE_DAYS, LEFTOVER_UNIT } from "../../data/index.ts";

export function leftoverIngredientId(recipe: Recipe): IngredientId {
  return makeIngredientId(`leftover-${slugify(recipe.name)}`);
}

export interface ResolveLeftoverIngredientResult {
  readonly ingredient: Ingredient;
  /** True if this ingredient didn't already exist in `catalog` and must be upserted before the leftover lot is created. */
  readonly isNew: boolean;
}

/**
 * Finds the existing "Leftover: <recipe>" catalog entry, or builds a new
 * one (never upserted here — the caller does that, same as every other
 * event-building helper in this app: build, then the caller decides how/
 * when to persist).
 */
export function resolveLeftoverIngredient(
  recipe: Recipe,
  catalog: readonly Ingredient[],
  location: StorageLocation = LEFTOVER_DEFAULT_LOCATION,
): ResolveLeftoverIngredientResult {
  const id = leftoverIngredientId(recipe);
  const existing = catalog.find((i) => i.id === id);
  if (existing) return { ingredient: existing, isNew: false };
  return {
    ingredient: {
      id,
      name: `Leftover: ${recipe.name}`,
      unit: LEFTOVER_UNIT,
      shelfLifeDays: LEFTOVER_FRIDGE_SHELF_LIFE_DAYS,
      openedShelfLifeDays: LEFTOVER_FRIDGE_SHELF_LIFE_DAYS,
      defaultLocation: location,
    },
    isNew: true,
  };
}
