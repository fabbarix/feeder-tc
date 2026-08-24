export type ProductsView = "catalog" | "prices";

/**
 * The "Catalog" / "Price history" toggle shared by `ProductsList.tsx` and
 * `PriceHistory.tsx` (WP-VC5 — folding price history inside the "Products"
 * tab instead of giving it a fourth top-level tab; see `ProductsList.tsx`'s
 * doc comment). Both routes render the same `SegmentedControl` driven by
 * this list so the toggle looks and reads identically regardless of which
 * of the two routes is currently active.
 */
export const PRODUCTS_VIEW_OPTIONS: readonly { value: ProductsView; label: string }[] = [
  { value: "catalog", label: "Catalog" },
  { value: "prices", label: "Price history" },
];
