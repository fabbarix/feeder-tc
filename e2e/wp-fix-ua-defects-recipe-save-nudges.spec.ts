import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// UA review findings #3b and #4 — RecipeEditor.tsx.
//
// #3b: a recipe saved with no meal tags used to save silently, then never
// show up in "Generate week" or a "Pick a meal" sheet with no explanation
// anywhere. #4: a completely empty recipe (name only) used to save exactly
// as successfully as a real one and land in the list looking real. Neither
// should be BLOCKED (both are legitimate) — but the person should be told
// what they're doing before Save actually commits it.
//
// Both fail on `origin/main` (a367ab3): that build's `handleSave` has only
// the two checks that were already there (required fields, and a partially-
// filled ingredient line) — no confirm dialog for either case, so Save just
// succeeds immediately and these specs' dialog locators never appear.

test("saving a recipe with no meal tags warns before committing", async ({ page }) => {
  await enterReadyShell(page, "recipes/new");
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();

  await page.getByRole("textbox", { name: "Name" }).fill("Untagged Soup");
  await page.getByRole("button", { name: "Add ingredient line" }).click();
  await page.getByRole("button", { name: /^Ingredient/i }).click();
  await page.getByRole("option", { name: "Ground beef", exact: true }).click();
  await page.getByRole("textbox", { name: /amount/i }).fill("100");
  await page.getByRole("textbox", { name: "Cook time (min)" }).fill("20");

  // No meal tag touched — Save should warn, not save silently.
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "No meal tags" })).toBeVisible();
  await expect(page.getByText(/never appears in "Generate week" or the "Pick a meal" sheet/i)).toBeVisible();

  // Cancelling ("Add a tag") keeps the person on the editor, recipe unsaved.
  await page.getByRole("button", { name: "Add a tag" }).click();
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();

  // Confirming saves anyway.
  await page.getByRole("button", { name: "Save recipe" }).click();
  await page.getByRole("button", { name: "Save anyway" }).click();
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
});

test("saving a completely empty recipe warns before committing", async ({ page }) => {
  await enterReadyShell(page, "recipes/new");
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();

  // Name only — no ingredients, no steps, no meal tag either, but the
  // no-tags nudge is expected to come first and this test only cares about
  // the emptiness one, so it tags the recipe to skip straight past that.
  await page.getByRole("textbox", { name: "Name" }).fill("Empty Placeholder");
  await page.getByRole("group", { name: "Meal tags" }).getByRole("button", { name: "Dinner" }).click();
  await page.getByRole("textbox", { name: "Cook time (min)" }).fill("20");

  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Nothing to cook from yet" })).toBeVisible();
  await expect(page.getByText(/won't add anything to a shopping list or show how to cook it/i)).toBeVisible();

  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();

  await page.getByRole("button", { name: "Save recipe" }).click();
  await page.getByRole("button", { name: "Save anyway" }).click();
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
});
