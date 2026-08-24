import type { RouteTabItem } from "../../ui/components";

/**
 * The two sibling tabs of the "Products" area — mirrors
 * `recipe-tabs.ts`/`RECIPE_SECTION_TABS`'s exact pattern (WP-VC4), so a
 * `RouteTabs` here behaves identically to the one Recipes/Ingredients
 * already ships. "Products" (browse/edit/barcodes/merge — this package's
 * own new screen) is the default tab; "Price history" is the pre-existing
 * per-ingredient/per-product price view (`PriceHistory.tsx`), now reachable
 * as a sibling of the new screen rather than the only thing this area
 * offered.
 */
export const PRODUCT_SECTION_TABS: readonly RouteTabItem[] = [
  { to: "/products", label: "Products", id: "products-panel", end: true },
  { to: "/products/prices", label: "Price history", id: "products-prices-panel" },
];
