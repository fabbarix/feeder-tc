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
