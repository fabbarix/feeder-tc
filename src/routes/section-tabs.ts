import type { RouteTabItem } from "../ui/components";

/**
 * The three sibling tabs of the "Recipes" area — Recipes.tsx /
 * Ingredients.tsx / products/ProductsList.tsx — one shared list so all
 * three routes render the exact same `id`/`to`/`label` triples and can
 * never drift apart (WP-VC4/WP-VC5). `id` doubles as the `<section
 * role="tabpanel">` id each route renders for itself; `RouteTabs` derives
 * `${id}-tab` for the matching tab's own id/aria-controls pairing.
 *
 * "Products" joined this strip in the WP-VC5 defect sweep (previously its
 * own top-level `/products` area with a `Products | Price history` strip
 * that had no link INTO it from anywhere a user would think to look —
 * owner-reported: "Products is not discoverable"). It is not `end`-matched:
 * a product's own detail page (`/products/:id`) and the price-history view
 * folded into this same area (`/products/prices`, `/products/prices/
 * ingredient/:id`) all keep "Products" showing as the active tab, the same
 * way a recipe's own detail page is not part of this strip's matching at
 * all (it lives outside the tabbed area entirely) but `/recipes/ingredients`
 * matching the "Ingredients" tab works the same way one level up.
 */
export const SECTION_TABS: readonly RouteTabItem[] = [
  { to: "/recipes", label: "Recipes", id: "recipes-panel", end: true },
  { to: "/recipes/ingredients", label: "Ingredients", id: "ingredients-panel" },
  { to: "/products", label: "Products", id: "products-panel" },
];
