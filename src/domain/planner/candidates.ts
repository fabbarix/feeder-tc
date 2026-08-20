/**
 * Candidate pools by meal tag and 3-state status, plus the N-week
 * repeat-exclusion window — WP-13.
 *
 * "Never places a retired recipe or a wrong-meal-tag recipe" (IMPLEMENTATION_PLAN.md
 * WP-13 success criteria) starts here: every candidate list the generator
 * ever samples from is built by `candidatesForSlot`, so the retired/wrong-tag
 * filter has exactly one implementation to get right instead of one per call
 * site.
 */
import { addDays, isBefore } from "../dates.ts";
import type { IsoDate, MealTag, PlanSlot, Recipe, RecipeId, RecipeStatus } from "../types.ts";

/**
 * Recipes tagged for `mealTag` whose household status is one of `statuses`.
 * The generator calls this once with `["staple"]` and once with
 * `["in-rotation"]` — `"retired"` is simply never asked for, which is what
 * keeps a retired recipe from ever entering a candidate pool in the first
 * place (rather than being filtered out after the fact).
 */
export function candidatesForSlot(
  recipes: readonly Recipe[],
  mealTag: MealTag,
  statuses: readonly RecipeStatus[],
): readonly Recipe[] {
  return recipes.filter(
    (recipe) => statuses.includes(recipe.status) && recipe.mealTags.includes(mealTag),
  );
}

/**
 * Cooked history is derived from `PlanSlot.date` + `PlanSlot.state ===
 * "cooked"` (contracts.ts doc comment on `PlanSlot`) — there is no separate
 * history entity. A recipe is excluded from a week starting `weekStart` if
 * it was cooked on or after `weekStart` minus `repeatExclusionWeeks` weeks.
 *
 * `repeatExclusionWeeks <= 0` disables the exclusion entirely (an empty set)
 * rather than treating it as "exclude everything cooked in the future",
 * which a negative/zero cutoff window would otherwise compute nonsensically.
 */
export function recentlyCookedRecipeIds(
  pastPlanSlots: readonly PlanSlot[],
  weekStart: IsoDate,
  repeatExclusionWeeks: number,
): ReadonlySet<RecipeId> {
  const ids = new Set<RecipeId>();
  if (repeatExclusionWeeks <= 0) {
    return ids;
  }
  const cutoff = addDays(weekStart, -7 * repeatExclusionWeeks);
  for (const slot of pastPlanSlots) {
    if (slot.state !== "cooked") continue;
    if (slot.filling.kind !== "recipe") continue;
    if (isBefore(slot.date, cutoff)) continue;
    ids.add(slot.filling.recipeId);
  }
  return ids;
}
