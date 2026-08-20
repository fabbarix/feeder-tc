/** Shared allowed-value lists for the codec `cellEnum`/validity checks below (WP-11). */
import type {
  MealTag,
  PlanSlotState,
  RecipeKind,
  RecipeStatus,
  StorageLocation,
  Unit,
  Weekday,
} from "../../domain/types.ts";

export const UNITS: readonly Unit[] = ["g", "ml", "piece", "portion"];
export const STORAGE_LOCATIONS: readonly StorageLocation[] = ["pantry", "fridge", "freezer"];
export const MEAL_TAGS: readonly MealTag[] = ["breakfast", "lunch", "dinner", "snack"];
export const RECIPE_KINDS: readonly RecipeKind[] = ["cooked", "bought"];
export const RECIPE_STATUSES: readonly RecipeStatus[] = ["staple", "in-rotation", "retired"];
export const PLAN_SLOT_STATES: readonly PlanSlotState[] = ["planned", "cooked", "skipped"];
export const WEEKDAYS: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
export const EVENT_TYPES = ["purchase", "use", "spoil", "adjust", "move", "open"] as const;
export const FILLING_KINDS = ["recipe", "leftover", "empty"] as const;

export function isUnit(value: string): value is Unit {
  return (UNITS as readonly string[]).includes(value);
}

export function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

export function isMealTag(value: string): value is MealTag {
  return (MEAL_TAGS as readonly string[]).includes(value);
}
