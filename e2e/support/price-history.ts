import { expect, type Page } from "@playwright/test";

/**
 * The price-history view has no primary-nav entry of its own by design
 * (`PantryItem.tsx`'s own comment, M6/DESIGN_PRODUCTS.md §1.4) — it's only
 * reached from an ingredient's own pantry-item page, same as the
 * scan-route's known-product flow links to the product-level page. Reaches
 * the per-INGREDIENT drill-down; the top-level `/products/prices` list is
 * only reachable from there via its own "← Price history" back link (see
 * `goToPriceHistoryList` below) — never a direct nav click.
 */
export async function openIngredientPriceHistory(page: Page, ingredientName: string): Promise<void> {
  await page.getByRole("link", { name: "Price history" }).click();
  // Once loaded, the page's own `<h1>` is the ingredient's NAME (not the
  // literal string "Price history" — that only appears transiently for the
  // loading/error states, PriceHistoryIngredient.tsx:79-97), with "Price
  // history · every observation for this ingredient" as its subtitle.
  await expect(page.getByRole("heading", { name: ingredientName, level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Price history");
}

/**
 * From a per-ingredient drill-down, the "← Price history" back link reaches
 * the top-level list. WP-VC5 (2026-08-24): "Products" is now the third tab
 * of the shared Recipes/Ingredients/Products strip (discoverability fix —
 * the old standalone `/products` area had no link into it from anywhere a
 * user would think to look), and "Price history" is a `SegmentedControl`
 * ("Catalog"/"Price history") folded INSIDE that same "Products" tab rather
 * than a fourth top-level tab — see `ProductsList.tsx`'s doc comment. The
 * area's `<h1>` is visually hidden now (WP-VC5's heading-duplication fix),
 * so the reliable signal that landed on the right view is the "Products"
 * tab being selected and the "Price history" radio being checked, not a
 * visible heading.
 */
export async function goToPriceHistoryList(page: Page): Promise<void> {
  await page.getByRole("link", { name: /Price history/ }).click();
  await expect(page.getByRole("tab", { name: "Products" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("radio", { name: "Price history" })).toBeChecked();
}

/**
 * The per-ingredient page's "By product" rail links to the full product
 * screen (`ProductDetail.tsx`, WP-products-screen — supersedes the old
 * per-barcode-only `PriceHistoryProduct.tsx`, which this same click used to
 * land on) — only present once at least one observation is tied to a
 * scanned product.
 */
export async function openProductPriceHistory(page: Page, productName: string): Promise<void> {
  await page.getByRole("link", { name: productName }).click();
  await expect(page.getByRole("heading", { name: productName, level: 1 })).toBeVisible();
}
