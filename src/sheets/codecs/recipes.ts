/** `Recipes` sheet codec (WP-11) — DESIGN.md §3 / §2 "Recipes". */
import type { CellRow } from "../../domain/contracts.ts";
import { makeRecipeId, type MealTag, type Recipe } from "../../domain/types.ts";
import { cellEnum, cellNumber, cellOptionalString, cellString } from "./common.ts";
import { MEAL_TAGS, RECIPE_KINDS, RECIPE_STATUSES } from "./enums.ts";

export const RECIPES_HEADER: CellRow = [
  "id",
  "name",
  "kind",
  "base_servings",
  "prep_minutes",
  "cook_minutes",
  "meal_tags",
  "status",
];

/**
 * `meal_tags` is a comma-joined subset of the small, fixed `MealTag` enum —
 * still a plain scalar a human can type ("dinner,snack"), not a JSON blob
 * (invariant 6). Every other multi-row relationship in the schema
 * (ingredient lines, steps) gets its own join sheet; this field alone stays
 * inline because it is a small closed set directly on the Recipe record
 * itself in DESIGN.md §3's table, not a join.
 */
function encodeMealTags(tags: readonly MealTag[]): string {
  return tags.join(",");
}

function decodeMealTags(row: CellRow): readonly MealTag[] {
  const raw = cellOptionalString(row, 6);
  if (raw === undefined) return [];
  return raw.split(",").map((part) => {
    const tag = part.trim();
    if (!(MEAL_TAGS as readonly string[]).includes(tag)) {
      throw new Error(`meal_tags contains an unrecognised tag ${JSON.stringify(tag)}`);
    }
    return tag as MealTag;
  });
}

export function encodeRecipe(recipe: Recipe): CellRow {
  return [
    recipe.id,
    recipe.name,
    recipe.kind,
    recipe.baseServings,
    recipe.prepMinutes,
    recipe.cookMinutes,
    encodeMealTags(recipe.mealTags),
    recipe.status,
  ];
}

/**
 * `kind: "bought"` recipes always have `prepMinutes === 0` — types.ts
 * documents this as "enforced by the codec/UI, not the type"; this is that
 * enforcement on the read path, so a hand-edited bought recipe with a
 * non-zero prep time is quarantined rather than silently accepted.
 */
export function decodeRecipe(row: CellRow): Recipe {
  const id = makeRecipeId(cellString(row, 0, "id"));
  const name = cellString(row, 1, "name");
  const kind = cellEnum(row, 2, "kind", RECIPE_KINDS);
  const baseServings = cellNumber(row, 3, "base_servings");
  const prepMinutes = cellNumber(row, 4, "prep_minutes");
  const cookMinutes = cellNumber(row, 5, "cook_minutes");
  const mealTags = decodeMealTags(row);
  const status = cellEnum(row, 7, "status", RECIPE_STATUSES);

  if (baseServings <= 0) {
    throw new Error(`base_servings must be greater than 0, got ${baseServings}`);
  }
  if (prepMinutes < 0) {
    throw new Error(`prep_minutes must not be negative, got ${prepMinutes}`);
  }
  if (cookMinutes < 0) {
    throw new Error(`cook_minutes must not be negative, got ${cookMinutes}`);
  }
  if (kind === "bought" && prepMinutes !== 0) {
    throw new Error(`a "bought" recipe must have prep_minutes 0, got ${prepMinutes}`);
  }

  return { id, name, kind, baseServings, prepMinutes, cookMinutes, mealTags, status };
}
