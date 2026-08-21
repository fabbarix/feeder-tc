import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// IMPLEMENTATION_PLAN.md WP-20, `@e2e`:
//
// Feature: Recipe management
//   Scenario: Creating a bought meal
//     Given a signed-in user with an active workbook
//     When they create a recipe "Store lasagna" of kind "bought"
//       with cook time 50 minutes and steps "375 degrees, 30 min covered, 20 uncovered"
//     Then the recipe saves with prep time 0
//     And a catalog ingredient "Store lasagna" with unit "piece" is linked
test("Creating a bought meal", async ({ page }) => {
  // Given a signed-in user with an active workbook
  await enterReadyShell(page, "recipes");
  await page.getByRole("link", { name: "Add recipe" }).click();
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();

  // When they create a recipe "Store lasagna" of kind "bought" with cook
  // time 50 minutes and steps "375 degrees, 30 min covered, 20 uncovered"
  await page.getByRole("textbox", { name: "Name" }).fill("Store lasagna");
  await page.getByRole("radio", { name: "Store-bought" }).click();
  // Selecting "bought" hides the prep-time field entirely and replaces it
  // with a fixed "0 min" hint (RecipeEditor.tsx) — prep is not user-entered.
  await expect(page.getByText("0 min — store-bought meals have no prep step.")).toBeVisible();
  await page.getByRole("textbox", { name: "Cook time (min)" }).fill("50");
  // One empty step field exists by default — no need to add another.
  await page.getByRole("textbox", { name: "Step 1" }).fill("375 degrees, 30 min covered, 20 uncovered");

  await page.getByRole("button", { name: "Save recipe" }).click();

  // Then the recipe saves with prep time 0 — back on the recipe list, the
  // card is tagged "Bought" and shows "0 prep" / "50 cook" directly...
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Bought");
  await expect(page.getByRole("main")).toContainText("0 prep");
  await expect(page.getByRole("main")).toContainText("50 cook");

  // ...confirmed directly on the recipe itself: clicking the card now opens
  // the read-only recipe view (WP-VC2 — design/mock-screens.html #recipe),
  // not straight into the editor. Its own "Edit" action is what reaches the
  // editor, where bought recipes never show an editable prep-time field,
  // only the fixed "0 min" hint.
  await page.getByRole("link", { name: "Store lasagna" }).click();
  await expect(page.getByRole("heading", { name: "Store lasagna" })).toBeVisible();
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit recipe" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Store-bought" })).toBeChecked();
  await expect(page.getByText("0 min — store-bought meals have no prep step.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Cook time (min)" })).toHaveValue("50");

  // And a catalog ingredient "Store lasagna" with unit "piece" is linked —
  // via the primary nav (exact match: the page also has a "← Recipes"
  // breadcrumb, which would otherwise ambiguously match too). The
  // ingredients catalog is now a proper tab of Recipes (RouteTabs,
  // UI_DESIGN.md — owner-reported, comparing production to the approved
  // mock: it was a stray unstyled `<Link>` before), not a standalone
  // "Ingredients catalog" link.
  await page.getByRole("link", { name: "Recipes", exact: true }).click();
  await page.getByRole("link", { name: "Ingredients", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ingredients" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search" }).fill("Store lasagna");
  await expect(page.getByRole("link", { name: "Store lasagna" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("piece");
});

// IMPLEMENTATION_PLAN.md WP-20, `@e2e`:
//
//   Scenario: Retiring a recipe
//     When the user sets "Liver stew" status to retired
//     Then "Liver stew" shows as retired in the recipe list
test("Retiring a recipe", async ({ page }) => {
  await enterReadyShell(page, "recipes");

  // Arrange: a recipe "Liver stew" to retire (the scenario's own Given —
  // an existing recipe — is out of scope for a fresh workbook, so this
  // creates it via the same UI as any other recipe). Base servings defaults
  // to 4 already (ServingsStepper's initial value), so nothing to fill there.
  await page.getByRole("link", { name: "Add recipe" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Liver stew");
  await page.getByRole("textbox", { name: "Cook time (min)" }).fill("40");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();

  // When the user sets "Liver stew" status to retired. The "Household
  // flag" segmented control is a live, immediate-write action right on the
  // read-only recipe view itself (WP-VC2 — design/mock-screens.html
  // #recipe's rail control), not something that requires opening the
  // editor and saving a form: open the recipe and flip it there directly.
  await page.getByRole("link", { name: "Liver stew" }).click();
  await expect(page.getByRole("heading", { name: "Liver stew" })).toBeVisible();
  await page.getByRole("radio", { name: "Retired" }).click();
  await expect(page.getByRole("radio", { name: "Retired" })).toBeChecked();

  // Then "Liver stew" shows as retired in the recipe list. Via the primary
  // nav explicitly (not just `{ name: "Recipes" }`): Recipes also has its
  // own `RouteTabs` "Recipes" tab (WP-VC — the ingredients catalog is
  // reachable as a proper tab now), so an unscoped locator can transiently
  // match both mid-navigation.
  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  await primaryNav.getByRole("link", { name: "Recipes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Retired");

  // Persisted, not just local state — reload the list and check again.
  await primaryNav.getByRole("link", { name: "Home" }).click();
  await primaryNav.getByRole("link", { name: "Recipes", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Retired");
});
