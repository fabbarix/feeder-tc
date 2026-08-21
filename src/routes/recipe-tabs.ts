import type { RouteTabItem } from "../ui/components";

/**
 * The two sibling tabs of the "Recipes" area (Recipes.tsx / Ingredients.tsx)
 * — one shared list so both routes render the exact same `id`/`to`/`label`
 * triples and can never drift apart (WP-VC4). `id` doubles as the `<section
 * role="tabpanel">` id each route renders for itself; `RouteTabs` derives
 * `${id}-tab` for the matching tab's own id/aria-controls pairing.
 */
export const RECIPE_SECTION_TABS: readonly RouteTabItem[] = [
  { to: "/recipes", label: "Recipes", id: "recipes-panel", end: true },
  { to: "/recipes/ingredients", label: "Ingredients", id: "ingredients-panel" },
];
