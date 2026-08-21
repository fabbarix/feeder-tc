import { expect, type Page } from "@playwright/test";

/**
 * Adds a minimal cooked recipe through the real "Add recipe" flow — name and
 * cook time only, no ingredient lines or steps, which is all any spec using
 * this needs. Shared by every spec that just needs "a recipe exists" as
 * setup (previously copy-pasted verbatim into wp-vc-visual-conformance.spec.ts
 * and wp-vc2-visual-conformance.spec.ts — WP-30 consolidated both onto this
 * one copy rather than adding a third).
 */
export async function addRecipe(page: Page, name: string, cookMinutes: number): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipes", exact: true }).click();
  await page.getByRole("link", { name: /Add recipe|New recipe/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Cook time (min)" }).fill(String(cookMinutes));
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
}
