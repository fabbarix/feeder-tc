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

/** From a per-ingredient drill-down, the "← Price history" back link reaches the top-level list — the only way a person gets there, since it has no nav entry of its own. */
export async function goToPriceHistoryList(page: Page): Promise<void> {
  await page.getByRole("link", { name: /Price history/ }).click();
  await expect(page.getByRole("heading", { name: "Price history", level: 1 })).toBeVisible();
}

/** The per-ingredient page's "By product" rail links to a per-PRODUCT drill-down (`PriceHistoryIngredient.tsx`) — only present once at least one observation is tied to a scanned product. */
export async function openProductPriceHistory(page: Page, productName: string): Promise<void> {
  await page.getByRole("link", { name: productName }).click();
  // Same "literal 'Price history' only while loading/erroring, the entity's
  // own name once loaded" shape as the ingredient page (PriceHistoryProduct.tsx:57-83).
  await expect(page.getByRole("heading", { name: productName, level: 1 })).toBeVisible();
}
