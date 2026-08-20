/** `RecipeSteps` sheet codec (WP-11) — DESIGN.md §3: one row per (recipe_id, step_no, text). */
import type { CellRow } from "../../domain/contracts.ts";
import { makeRecipeId, type RecipeStep } from "../../domain/types.ts";
import { cellNumber, cellString } from "./common.ts";

export const RECIPE_STEPS_HEADER: CellRow = ["recipe_id", "step_number", "text"];

export function encodeRecipeStep(step: RecipeStep): CellRow {
  return [step.recipeId, step.stepNumber, step.text];
}

export function decodeRecipeStep(row: CellRow): RecipeStep {
  const recipeId = makeRecipeId(cellString(row, 0, "recipe_id"));
  const stepNumber = cellNumber(row, 1, "step_number");
  const text = cellString(row, 2, "text");
  if (stepNumber <= 0) {
    throw new Error(`step_number must be greater than 0, got ${stepNumber}`);
  }
  return { recipeId, stepNumber, text };
}
