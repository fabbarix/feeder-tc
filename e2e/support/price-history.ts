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
 * the top-level list. WP-products-screen (2026-08-23): that list now lives
 * under a shared "Products" area (`<h1>Products</h1>` + a `Products`/`Price
 * history` `RouteTabs` pair, mirroring `Recipes.tsx`/`Ingredients.tsx`'s own
 * "one h1, tabs are the section header" convention) rather than carrying its
 * own literal "Price history" `<h1>` — the tab's `aria-selected` is the
 * reliable signal that landed on the right sibling route.
 */
export async function goToPriceHistoryList(page: Page): Promise<void> {
  await page.getByRole("link", { name: /Price history/ }).click();
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Price history" })).toHaveAttribute("aria-selected", "true");
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
