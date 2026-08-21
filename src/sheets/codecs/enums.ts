/** Shared allowed-value lists for the codec `cellEnum`/validity checks below (WP-11, extended M6-A). */
import type {
  EntryUnit,
  IngredientCategory,
  MealTag,
  PhotoOwnerKind,
  PlanSlotState,
  RecipeKind,
  RecipeStatus,
  StorageLocation,
  Unit,
  Weekday,
} from "../../domain/types.ts";

export const UNITS: readonly Unit[] = ["g", "ml", "piece", "portion"];
/** WP-VC3 — Ingredient.category's allowed values, matching the seed catalog's groups. */
export const INGREDIENT_CATEGORIES: readonly IngredientCategory[] = [
  "produce",
  "dairy-eggs",
  "meat-fish",
  "dry-goods",
  "tinned-jarred",
  "frozen",
  "condiments",
  "baking",
  "herbs-spices",
  "drinks",
];
/**
 * M6-A — DESIGN_PRODUCTS.md §3: the units the `Products` sheet's
 * `display_unit` column may hold (provenance only, never used in arithmetic
 * — see src/domain/units.ts). WP-PURCHASING (§10.3) appended `cup`/`tbsp`/
 * `tsp`, additive — also the allowed set for `RecipeIngredients`'
 * `display_unit` column, which reuses this same list rather than a second
 * one for the identical concept.
 */
export const ENTRY_UNITS: readonly EntryUnit[] = [
  "kg",
  "g",
  "lb",
  "oz",
  "l",
  "ml",
  "fl oz",
  "piece",
  "cup",
  "tbsp",
  "tsp",
];
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
/** WP-PHOTO — `Photo.ownerKind`'s allowed values (DESIGN_PHOTOS.md §2). */
export const PHOTO_OWNER_KINDS: readonly PhotoOwnerKind[] = ["recipe", "recipe-step", "ingredient", "product"];

export function isUnit(value: string): value is Unit {
  return (UNITS as readonly string[]).includes(value);
}

export function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

export function isMealTag(value: string): value is MealTag {
  return (MEAL_TAGS as readonly string[]).includes(value);
}

export function isIngredientCategory(value: string): value is IngredientCategory {
  return (INGREDIENT_CATEGORIES as readonly string[]).includes(value);
}

/** WP-PURCHASING — validates a `RecipeIngredients.display_unit` (or `Products.display_unit`) cell against the full `EntryUnit` set. */
export function isEntryUnit(value: string): value is EntryUnit {
  return (ENTRY_UNITS as readonly string[]).includes(value);
}

/** WP-PURCHASING (DESIGN_PURCHASING.md §3) — `Ingredient.purchase_mode`'s allowed values. */
export const PURCHASE_MODES = ["whole", "loose"] as const;
export type PurchaseModeValue = (typeof PURCHASE_MODES)[number];

export function isPurchaseMode(value: string): value is PurchaseModeValue {
  return (PURCHASE_MODES as readonly string[]).includes(value);
}
