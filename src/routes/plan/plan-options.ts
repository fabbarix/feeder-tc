/**
 * Recipe candidate pools for the Plan route's manual-pick pickers (WP-22).
 * "Never places a retired recipe" (WP-13's own generator rule) applies to
 * manual placement too — a household member picking a meal by hand should
 * see the same staple/in-rotation pool the generator draws from, not
 * retired recipes creeping back in through a side door.
 */
import type { MealTag, Recipe } from "../../domain/index.ts";

/** Non-retired recipes tagged for `mealTag`, sorted by name — the manual "pick a meal" pool. */
export function pickableRecipesForTag(recipes: readonly Recipe[], mealTag: MealTag): readonly Recipe[] {
  return recipes
    .filter((recipe) => recipe.status !== "retired" && recipe.mealTags.includes(mealTag))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}
