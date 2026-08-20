/** `Ingredients` sheet codec (WP-11) — DESIGN.md §3 / §2 "Ingredients". */
import type { CellRow } from "../../domain/contracts.ts";
import { makeIngredientId, type Ingredient } from "../../domain/types.ts";
import { cellEnum, cellNumber, cellString } from "./common.ts";
import { STORAGE_LOCATIONS, UNITS } from "./enums.ts";

export const INGREDIENTS_HEADER: CellRow = [
  "id",
  "name",
  "unit",
  "shelf_life_days",
  "opened_shelf_life_days",
  "default_location",
];

export function encodeIngredient(ingredient: Ingredient): CellRow {
  return [
    ingredient.id,
    ingredient.name,
    ingredient.unit,
    ingredient.shelfLifeDays,
    ingredient.openedShelfLifeDays,
    ingredient.defaultLocation,
  ];
}

/**
 * `unit` is validated against the canonical `Unit` union — the BDD example
 * ("a row with unit 'banana-units'") is this exact check. Invariant 3's
 * "reject mixed-unit writes at the codec layer" is enforced here at the
 * source: every other sheet that references an ingredient (RecipeIngredients)
 * cross-checks against whatever unit this row decodes to.
 */
export function decodeIngredient(row: CellRow): Ingredient {
  const id = makeIngredientId(cellString(row, 0, "id"));
  const name = cellString(row, 1, "name");
  const unit = cellEnum(row, 2, "unit", UNITS);
  const shelfLifeDays = cellNumber(row, 3, "shelf_life_days");
  const openedShelfLifeDays = cellNumber(row, 4, "opened_shelf_life_days");
  const defaultLocation = cellEnum(row, 5, "default_location", STORAGE_LOCATIONS);
  if (shelfLifeDays < 0) {
    throw new Error(`shelf_life_days must not be negative, got ${shelfLifeDays}`);
  }
  if (openedShelfLifeDays < 0) {
    throw new Error(`opened_shelf_life_days must not be negative, got ${openedShelfLifeDays}`);
  }
  return { id, name, unit, shelfLifeDays, openedShelfLifeDays, defaultLocation };
}
