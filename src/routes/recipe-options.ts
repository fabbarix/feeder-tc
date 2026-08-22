/** Shared option lists for the recipe list card and editor (WP-20) — the fixed, small enums `SegmentedControl`/`ToggleChips` render inline (UI_DESIGN.md §5). */
import type { MealTag, RecipeKind, RecipeStatus } from "../domain/index.ts";

// Labels match the approved mock exactly (design/mock-screens.html #recipe's
// `.seg` control: "Staple" / "Rotation" / "Retired") — "Rotation", not "In
// rotation": the mock's own three-button segmented control reads that way on
// both phone and desktop. The underlying `RecipeStatus` value stays
// "in-rotation" (frozen in src/domain/types.ts); only the display label
// changed.
export const STATUS_OPTIONS: readonly { value: RecipeStatus; label: string }[] = [
  { value: "staple", label: "Staple" },
  { value: "in-rotation", label: "Rotation" },
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

/**
 * "Can't be split" (WP-purchasing-editor — DESIGN_PURCHASING.md §4/§8),
 * rendered as the same two-option `SegmentedControl` as Kind/Household
 * flag — this file has no separate "toggle switch" idiom, and the mock's
 * own note is explicit that Kind is already this exact shape of binary
 * choice. `"splits" | "cant"` is a display-only local type — the boolean it
 * maps to is `Recipe.indivisible`'s effective value (`isIndivisible`,
 * `src/domain/purchasing.ts`).
 */
export type SplitChoice = "splits" | "cant";

export const SPLIT_OPTIONS: readonly { value: SplitChoice; label: string }[] = [
  { value: "splits", label: "Splits into portions" },
  { value: "cant", label: "Can't be split" },
];
