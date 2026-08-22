import { expect, type Page } from "@playwright/test";

/** Opens the ingredient combobox (SelectSheet) used by both the "Add to pantry" and "Record usage" forms and picks one option by its exact catalog name. */
export async function openIngredientSheet(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: /ingredient/i }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

/**
 * Adds a lot of an existing catalog ingredient through the real "Add to
 * pantry" flow (same steps as e2e/wp-21-pantry-management.spec.ts's own
 * "Adding existing pantry stock" scenario) — shared here because WP-30's
 * multi-client scenarios need it fired from more than one spec/page without
 * a second copy-paste of the form-filling steps.
 */
export async function addPantryStock(page: Page, ingredientName: string, amount: string): Promise<void> {
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await openIngredientSheet(page, ingredientName);
  await page.getByRole("textbox", { name: /amount/i }).fill(amount);
  await page.getByRole("button", { name: "Add to pantry" }).click();
  // Waits for the sheet to actually close (the ingredient combobox button
  // reappearing at the top of a fresh, empty form) before returning, so two
  // calls fired back-to-back on the SAME page never race one form against
  // the next one opening. Two DIFFERENT pages calling this concurrently are
  // of course unaffected — that overlap is the point of the concurrent-
  // appends scenario.
  await expect(page.getByRole("button", { name: /ingredient/i })).toHaveCount(0);
}

export async function goToPantry(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Pantry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pantry", level: 1 })).toBeVisible();
}

/** Opens an ingredient's own pantry-item detail route (`/pantry/:ingredientId`) via its real aggregated-row link on the Pantry list — never `page.goto`. */
export async function openPantryItem(page: Page, ingredientName: string): Promise<void> {
  await page.getByRole("link", { name: new RegExp(ingredientName) }).click();
  await expect(page.getByRole("heading", { name: ingredientName, level: 1 })).toBeVisible();
}

/**
 * The five lot-scoped actions all live on the pantry-item detail route's
 * "Record an event" rail as plain inline buttons — never a menu, never
 * "Edit" (invariant 1: corrections are new events) — at every tier
 * (PantryItem.tsx has no viewport-conditional button set, only a 1-col/
 * 2-col layout switch at 768px). Each opener/confirm pair below matches
 * `e2e/wp-21-pantry-management.spec.ts`'s own "Lot actions" scenario
 * verbatim, promoted here for reuse by the cross-tier journey.
 */
export async function moveLot(page: Page, toLocation: "Pantry" | "Fridge" | "Freezer"): Promise<void> {
  await page.getByRole("button", { name: "Move location" }).click();
  await page.getByRole("radio", { name: toLocation }).click();
  await page.getByRole("button", { name: "Confirm move" }).click();
}

export async function openLot(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open a lot" }).click();
  await page.getByRole("button", { name: "Mark opened" }).click();
}

export async function correctLot(page: Page, adjustBy: string, newExpiryPreset?: "+1w"): Promise<void> {
  await page.getByRole("button", { name: "Correct quantity or expiry" }).click();
  await page.getByRole("textbox", { name: /adjust amount by/i }).fill(adjustBy);
  if (newExpiryPreset) {
    await page.getByRole("group", { name: /new expiry/i }).getByRole("button", { name: newExpiryPreset }).click();
  }
  await page.getByRole("button", { name: "Save correction" }).click();
}

export async function spoilLot(page: Page, amount: string): Promise<void> {
  await page.getByRole("button", { name: "Mark spoiled" }).click();
  await page.getByRole("textbox", { name: /amount/i }).fill(amount);
  await page.getByRole("button", { name: "Confirm spoilage" }).click();
}

export async function recordUsage(page: Page, ingredientName: string, amount: string): Promise<void> {
  await page.getByRole("button", { name: "Record usage" }).click();
  await openIngredientSheet(page, ingredientName);
  await page.getByRole("textbox", { name: /amount used/i }).fill(amount);
  await page.getByRole("button", { name: "Record usage" }).click();
}
