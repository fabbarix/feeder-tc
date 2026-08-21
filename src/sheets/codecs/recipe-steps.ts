/**
 * `RecipeSteps` sheet codec (WP-11; widened WP-PHOTO — DESIGN_PHOTOS.md §3).
 * One row per (recipe, step). Column layout, in order:
 *
 *   recipe_id, step_number, description, id, detail, duration_minutes, has_photo
 *
 * `description` sits at index 2 — the exact position the original `text`
 * column occupied — deliberately, so a workbook written before WP-PHOTO
 * keeps decoding with no migration: its 3-cell rows (`recipe_id,
 * step_number, text`) are read as `recipe_id, step_number, description`
 * with nothing past index 2 present at all, not just blank.
 *
 * `id`, `detail`, `duration_minutes`, `has_photo` are the new trailing
 * columns. `detail`/`duration_minutes`/`has_photo` are genuinely optional on
 * `RecipeStep` (see types.ts) so an absent cell decodes to `undefined`,
 * exactly like `Ingredient.category`. `id` is different: `RecipeStep.id` is
 * **required** on the type — a step without identity is the bug WP-PHOTO
 * closes — but a legacy row still has no `id` cell to read. `legacyStepId`
 * below is what bridges that gap: on read, a missing `id` cell mints one
 * deterministically from `(recipe_id, step_number)` rather than throwing or
 * quarantining the row. Deterministic, not random (`newStepId`, which uses
 * the injected `Rng`, is for genuinely new steps only): re-reading the same
 * unmigrated row must keep producing the same id on every load, or two
 * clients (or two reads by the same client) would disagree about which
 * step a `Photo` row belongs to — silently reintroducing exactly the
 * position-keying bug this widening exists to fix. The minted id is never
 * written back automatically; it only becomes durable once something
 * legitimately re-saves the step (e.g. `replaceForRecipe`), at which point
 * the encoder writes a real `id` cell like any other row.
 */
import type { CellRow } from "../../domain/contracts.ts";
import { makeRecipeId, makeStepId, type RecipeStep, type StepId } from "../../domain/types.ts";
import { cellNumber, cellOptionalBoolean, cellOptionalNumber, cellOptionalString, cellString } from "./common.ts";

export const RECIPE_STEPS_HEADER: CellRow = [
  "recipe_id",
  "step_number",
  "description",
  "id",
  "detail",
  "duration_minutes",
  "has_photo",
];

/** Deterministic id for a legacy row with no `id` cell — see this module's doc comment for why determinism matters here. */
export function legacyStepId(recipeId: string, stepNumber: number): StepId {
  return makeStepId(`legacy:${recipeId}:${stepNumber}`);
}

export function encodeRecipeStep(step: RecipeStep): CellRow {
  return [
    step.recipeId,
    step.stepNumber,
    step.description,
    step.id,
    step.detail ?? "",
    step.durationMinutes ?? "",
    step.hasPhoto ?? "",
  ];
}

export function decodeRecipeStep(row: CellRow): RecipeStep {
  const recipeId = makeRecipeId(cellString(row, 0, "recipe_id"));
  const stepNumber = cellNumber(row, 1, "step_number");
  const description = cellString(row, 2, "description");
  if (stepNumber <= 0) {
    throw new Error(`step_number must be greater than 0, got ${stepNumber}`);
  }
  const idRaw = cellOptionalString(row, 3);
  const id = idRaw !== undefined ? makeStepId(idRaw) : legacyStepId(recipeId, stepNumber);
  const detail = cellOptionalString(row, 4);
  const durationMinutes = cellOptionalNumber(row, 5, "duration_minutes");
  const hasPhoto = cellOptionalBoolean(row, 6, "has_photo");
  return {
    recipeId,
    id,
    stepNumber,
    description,
    ...(detail !== undefined ? { detail } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    ...(hasPhoto !== undefined ? { hasPhoto } : {}),
  };
}
