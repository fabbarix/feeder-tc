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

// "Store-bought" wrapped to two lines in the "Kind & rotation" rail while
// its sibling "Cooked" stayed on one — the same line-wrap defect as
// SPLIT_OPTIONS below, found generically (e2e/wp-17-editor-copy-invariants.spec.ts)
// rather than by name. Shortened to "Bought", which also matches the
// underlying `RecipeKind` value ("bought") and reads fine standing next to
// "Cooked" on a recipe card/detail view elsewhere in the app.
export const KIND_OPTIONS: readonly { value: RecipeKind; label: string }[] = [
  { value: "cooked", label: "Cooked" },
  { value: "bought", label: "Bought" },
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

// Both labels must fit on one line inside the "Kind & rotation" rail
// (RecipeEditor.tsx's ~290px column, same as "Use in planning") at every
// width the app supports, not just the widest one — "Splits into portions"
// wrapped to two lines at 1512px while "Can't be split" sat one line tall
// beside it; shortening only the first to "Splits" fixed 1512px/390px but
// still left "Can't be split" itself wrapping to two lines at in-between
// desktop widths (measured ~1280px), with "Splits" now the short one. Both
// are shortened — "Splits" / "Whole" — so the pair is short enough to clear
// every width, not just the two spot-checked ones. The group itself is
// titled "Splitting", not either option's own text — see the field
// label/aria-label next to `SPLIT_OPTIONS` in RecipeEditor.tsx.
export const SPLIT_OPTIONS: readonly { value: SplitChoice; label: string }[] = [
  { value: "splits", label: "Splits" },
  { value: "cant", label: "Whole" },
];
