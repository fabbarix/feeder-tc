/**
 * Shopping-list category grouping (WP-VC3 — approved contract change,
 * `Ingredient.category`, see src/domain/types.ts). Pure display concern —
 * order and label only, no domain logic — so it lives in the route package,
 * not the kit (UI_DESIGN.md §7) and not `src/domain` (which has no opinion
 * on section labels).
 *
 * Mirrors `design/mock-screens.html` #shopping's `.rowgroup` subheadings
 * ("Produce", "Dry goods", …) and the seed catalog's own group order
 * (`src/data/seed-catalog.ts`'s `CATALOG_SECTIONS`).
 */
import type { IngredientCategory } from "../../domain/index.ts";

/** Display order for category sections; `undefined` (uncategorised) is handled separately and always sorts last. */
export const CATEGORY_ORDER: readonly IngredientCategory[] = [
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

export const CATEGORY_LABELS: Record<IngredientCategory, string> = {
  produce: "Produce",
  "dairy-eggs": "Dairy & eggs",
  "meat-fish": "Meat & fish",
  "dry-goods": "Dry goods",
  "tinned-jarred": "Tinned & jarred",
  frozen: "Frozen",
  condiments: "Condiments",
  baking: "Baking",
  "herbs-spices": "Herbs & spices",
  drinks: "Drinks",
};

/** Heading for ingredients with no `category` (a hand-added ingredient, or a legacy workbook row) — never omitted, never an empty group (see `groupByCategory`). */
export const UNCATEGORISED_LABEL = "Other";

/**
 * Groups an already-sorted (by name) list of `{ ingredient, ... }`-shaped
 * entries into `{ heading, entries }` sections, in `CATEGORY_ORDER`, with
 * "Other" last for anything uncategorised. A category with zero entries in
 * this list produces no section at all — never an empty group (WP-VC3
 * brief: "Never show an empty group").
 */
export function groupByCategory<T>(
  entries: readonly T[],
  categoryOf: (entry: T) => IngredientCategory | undefined,
): readonly { readonly heading: string; readonly entries: readonly T[] }[] {
  const byCategory = new Map<IngredientCategory | undefined, T[]>();
  for (const entry of entries) {
    const category = categoryOf(entry);
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(entry);
    else byCategory.set(category, [entry]);
  }

  const sections: { heading: string; entries: readonly T[] }[] = [];
  for (const category of CATEGORY_ORDER) {
    const bucket = byCategory.get(category);
    if (bucket && bucket.length > 0) sections.push({ heading: CATEGORY_LABELS[category], entries: bucket });
  }
  const uncategorised = byCategory.get(undefined);
  if (uncategorised && uncategorised.length > 0) {
    sections.push({ heading: UNCATEGORISED_LABEL, entries: uncategorised });
  }
  return sections;
}
