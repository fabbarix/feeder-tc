/** `RecipeIngredients` sheet codec (WP-11) — DESIGN.md §3: one row per (recipe_id, ingredient_id, quantity). */
import type { CellRow } from "../../domain/contracts.ts";
import {
  makeIngredientId,
  makeQuantity,
  makeRecipeId,
  type IngredientId,
  type RecipeIngredient,
  type Unit,
} from "../../domain/types.ts";
import { cellNumber, cellOptionalNumber, cellOptionalString, cellString } from "./common.ts";
import { isEntryUnit, isUnit, UNITS } from "./enums.ts";

export const RECIPE_INGREDIENTS_HEADER: CellRow = [
  "recipe_id",
  "ingredient_id",
  "quantity_amount",
  "quantity_unit",
  // WP-PURCHASING (DESIGN_PURCHASING.md §10.3), appended at the end
  // (additive — see types.ts's RecipeIngredient.displayQuantity/displayUnit
  // doc comment): provenance only, never read by any engine. A legacy row
  // has no cells here at all; decodeRecipeIngredient below treats that the
  // same as explicitly blank — both undefined, never a thrown error.
  "display_quantity",
  "display_unit",
];

export function encodeRecipeIngredient(line: RecipeIngredient): CellRow {
  return [
    line.recipeId,
    line.ingredientId,
    line.quantity.amount,
    line.quantity.unit,
    line.displayQuantity ?? "",
    line.displayUnit ?? "",
  ];
}

/**
 * `canonicalUnitOf` closes over the Ingredients catalog loaded alongside
 * this sheet (workbook-store.ts) so invariant 3 ("one canonical unit per
 * ingredient, reject mixed-unit writes at the codec layer") is enforced on
 * *read* too, not just at `WorkbookStore.recipeIngredients.replaceForRecipe`'s
 * write-time check: a human hand-editing `quantity_unit` in the sheet to
 * something that disagrees with the ingredient's canonical unit gets the
 * same "quarantine, don't crash" treatment as any other malformed row.
 */
export function decodeRecipeIngredient(
  row: CellRow,
  canonicalUnitOf: (id: IngredientId) => Unit | undefined,
): RecipeIngredient {
  const recipeId = makeRecipeId(cellString(row, 0, "recipe_id"));
  const ingredientId = makeIngredientId(cellString(row, 1, "ingredient_id"));
  const amount = cellNumber(row, 2, "quantity_amount");
  const unitRaw = cellString(row, 3, "quantity_unit");
  if (!isUnit(unitRaw)) {
    throw new Error(`quantity_unit must be one of ${UNITS.join(", ")}, got ${JSON.stringify(unitRaw)}`);
  }
  if (amount <= 0) {
    throw new Error(`quantity_amount must be greater than 0, got ${amount}`);
  }
  const canonical = canonicalUnitOf(ingredientId);
  if (canonical === undefined) {
    throw new Error(`references unknown ingredient "${ingredientId}"`);
  }
  if (canonical !== unitRaw) {
    throw new Error(
      `unit mismatch: ingredient "${ingredientId}"'s canonical unit is "${canonical}", but this line specifies "${unitRaw}" — each ingredient has one unit, and amounts are never converted`,
    );
  }

  // WP-PURCHASING display columns — provenance only (see this file's header
  // comment); an unrecognised/malformed display_unit is dropped rather than
  // quarantining the whole (structurally valid) row, same treatment
  // `Ingredients.category` gets.
  const displayQuantity = cellOptionalNumber(row, 4, "display_quantity");
  const displayUnitRaw = cellOptionalString(row, 5);
  const displayUnit = displayUnitRaw !== undefined && isEntryUnit(displayUnitRaw) ? displayUnitRaw : undefined;

  return {
    recipeId,
    ingredientId,
    quantity: makeQuantity(amount, unitRaw),
    ...(displayQuantity !== undefined ? { displayQuantity } : {}),
    ...(displayUnit !== undefined ? { displayUnit } : {}),
  };
}
