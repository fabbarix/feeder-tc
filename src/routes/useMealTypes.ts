import { useEffect, useState } from "react";
import { useWorkbookContext } from "../workbook-context.ts";
import { DEFAULT_MEAL_TYPES, mealTypesOf, type MealType } from "../domain/index.ts";

/**
 * The household's meal types for a screen that doesn't otherwise load
 * Settings (the recipe list and editor). Starts as — and stays on a failed
 * read as — `DEFAULT_MEAL_TYPES`, so a tag picker or filter row is never
 * empty while Settings loads; a household's own types replace them once read.
 */
export function useMealTypes(): readonly MealType[] {
  const { store } = useWorkbookContext();
  const [mealTypes, setMealTypes] = useState<readonly MealType[]>(DEFAULT_MEAL_TYPES);

  useEffect(() => {
    let cancelled = false;
    store.settings
      .read()
      .then((settings) => {
        if (!cancelled) setMealTypes(mealTypesOf(settings));
      })
      .catch(() => {
        // Keep the defaults — the screen still works with them.
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  return mealTypes;
}
