/**
 * The household's meal types (custom meal types, 2026-10-10) — the one place
 * that knows the defaults, display names, per-type servings and ordering.
 * Everything else asks here rather than assuming breakfast/lunch/dinner/snack.
 */
import type { MealTag, MealType, Settings } from "./types.ts";

/** What every workbook starts with, and what a workbook without meal-type rows means. */
export const DEFAULT_MEAL_TYPES: readonly MealType[] = [
  { id: "breakfast", name: "Breakfast" },
  { id: "lunch", name: "Lunch" },
  { id: "dinner", name: "Dinner" },
  { id: "snack", name: "Snack" },
];

/** A meal type id: a lowercase slug, readable in a sheet cell. */
const MEAL_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isMealTagId(value: string): value is MealTag {
  return MEAL_TAG_PATTERN.test(value);
}

/** The household's meal types, in display order — `DEFAULT_MEAL_TYPES` when it has never set its own. */
export function mealTypesOf(settings: Pick<Settings, "mealTypes"> | undefined): readonly MealType[] {
  return settings?.mealTypes ?? DEFAULT_MEAL_TYPES;
}

/**
 * A meal type's display name. An id the household no longer has (a recipe
 * or past slot tagged before its type was removed) falls back to the
 * default's name, then to the id itself — never a blank.
 */
export function mealTypeName(settings: Pick<Settings, "mealTypes"> | undefined, id: MealTag): string {
  return (
    mealTypesOf(settings).find((type) => type.id === id)?.name ??
    DEFAULT_MEAL_TYPES.find((type) => type.id === id)?.name ??
    id
  );
}

/** Servings a meal of this type is scaled to: the type's own, else the household size. */
export function servingsFor(settings: Pick<Settings, "mealTypes" | "householdSize">, id: MealTag): number {
  return mealTypesOf(settings).find((type) => type.id === id)?.servings ?? settings.householdSize;
}

/**
 * A fresh id for a new meal type named `name`: its slug, made unique
 * against `existing` ("cats-breakfast", then "cats-breakfast-2"). Ids never
 * change after this, so renaming a type never orphans its recipes.
 */
export function newMealTypeId(name: string, existing: readonly MealType[]): MealTag {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "meal";
  const taken = new Set(existing.map((type) => type.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
