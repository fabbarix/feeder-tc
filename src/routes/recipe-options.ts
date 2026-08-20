/** Shared option lists for the recipe list card and editor (WP-20) — the fixed, small enums `SegmentedControl`/`ToggleChips` render inline (UI_DESIGN.md §5). */
import type { MealTag, RecipeKind, RecipeStatus } from "../domain/index.ts";

export const STATUS_OPTIONS: readonly { value: RecipeStatus; label: string }[] = [
  { value: "staple", label: "Staple" },
  { value: "in-rotation", label: "In rotation" },
  { value: "retired", label: "Retired" },
];

export function statusLabel(status: RecipeStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export const KIND_OPTIONS: readonly { value: RecipeKind; label: string }[] = [
  { value: "cooked", label: "Cooked" },
  { value: "bought", label: "Store-bought" },
];

export const MEAL_TAG_OPTIONS: readonly { value: MealTag; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];
