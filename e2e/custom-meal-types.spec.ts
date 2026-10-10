import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { dismissToasts } from "./support/toast.ts";
import { makeDinnerOnly } from "./support/settings.ts";

// Custom meal types (2026-10-10): a household adds its own meal type with
// its own serving size, tags a recipe for it, and the planner only ever
// puts that recipe in that meal type's slots.

function goTo(page: Page, label: string) {
  return page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: label, exact: true }).click();
}

test("a custom meal type gets only the recipes tagged for it", async ({ page }) => {
  await enterReadyShell(page, "settings");
  await makeDinnerOnly(page);

  await page.getByRole("button", { name: "Add a meal type" }).click();
  await page.getByLabel("Name").fill("Cat's breakfast");
  await page.getByLabel(/Feeds the household/).uncheck();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("serves 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cat's breakfast on Sun" })).toHaveAttribute("aria-pressed", "true");
  await dismissToasts(page);

  await goTo(page, "Recipes");
  await page.getByRole("link", { name: /Add recipe|New recipe/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Kibble");
  await page.getByRole("group", { name: "Meal tags" }).getByRole("button", { name: "Cat's breakfast" }).click();
  await page.getByRole("button", { name: "Add ingredient line" }).click();
  await page.getByRole("button", { name: /^Ingredient/i }).click();
  await page.getByRole("option", { name: "Ground beef", exact: true }).click();
  await page.getByRole("textbox", { name: /amount/i }).fill("50");
  await page.getByRole("textbox", { name: "Cook time" }).fill("1");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
  // The Recipes filter row and the card's pill both use the household's name for the type.
  await expect(page.getByRole("button", { name: "Cat's breakfast", exact: true })).toBeVisible();
  await dismissToasts(page);

  await goTo(page, "Plan");
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Generate week" }).click();
  // The plan renders more than one layout and hides all but one, so look for a visible slot.
  await expect(page.getByRole("button", { name: "Kibble", exact: true }).filter({ visible: true }).first()).toBeVisible();

  const slots = page.locator('[class*="slotTag"]').locator("xpath=..").filter({ visible: true });
  const catSlots = slots.filter({ has: page.locator('[class*="slotTag"]', { hasText: /^Cat's breakfast/ }) });
  const dinnerSlots = slots.filter({ has: page.locator('[class*="slotTag"]', { hasText: /^Dinner/ }) });
  expect(await catSlots.count()).toBeGreaterThan(0);
  for (let i = 0; i < (await catSlots.count()); i += 1) {
    await expect(catSlots.nth(i)).toContainText("Kibble");
  }
  for (let i = 0; i < (await dinnerSlots.count()); i += 1) {
    await expect(dinnerSlots.nth(i)).not.toContainText("Kibble");
  }
});
