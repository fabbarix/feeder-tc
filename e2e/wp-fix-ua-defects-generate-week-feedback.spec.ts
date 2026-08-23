import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { dismissToasts } from "./support/toast.ts";

// UA review finding #3a: "Generate week" used to fill whatever it could and
// say NOTHING — a small recipe library (or none tagged for a meal at all)
// silently left most of the week empty with no clue why. This asserts what
// the person actually sees: a notification naming how many slots got filled
// and why the rest didn't, not an internal counter. Fails on `origin/main`
// (a367ab3) because that build fires no toast for "Generate week" at all —
// see `usePlanWeek.ts`'s old "no success toast" comment, which covered the
// EMPTY-result case too, not just the full-success one this finding leaves
// alone.

function goTo(page: Page, label: string) {
  return page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: label }).click();
}

test("generating a week with too few dinner recipes says how many slots filled and why the rest stayed empty", async ({
  page,
}) => {
  await enterReadyShell(page, "settings");

  // Dinner-only layout (7 open slots/week — see wp-22's own `makeDinnerOnly`).
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    for (const tag of ["Breakfast", "Lunch"]) {
      const button = page.getByRole("button", { name: `Remove ${tag} on ${day}` });
      await button.click();
      await expect(button).toHaveCount(0);
    }
  }

  // Exactly one dinner-tagged, in-rotation recipe: after it fills the first
  // slot, `weekPlacedRecipeIds` excludes it from every other slot this same
  // week (generator.ts step 2), so the other 6 slots have zero eligible
  // candidates — a small-library "starved" case, not a bug.
  await goTo(page, "Recipes");
  await page.getByRole("link", { name: /Add recipe|New recipe/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Only Dinner");
  await page.getByRole("group", { name: "Meal tags" }).getByRole("button", { name: "Dinner" }).click();
  // An ingredient line — irrelevant to this test, but keeps the save a
  // single click on both this branch and `main` (a completely empty recipe
  // gets a "save anyway?" nudge on this branch — item 4 — that `main`
  // doesn't have).
  await page.getByRole("button", { name: "Add ingredient line" }).click();
  await page.getByRole("button", { name: /^Ingredient/i }).click();
  await page.getByRole("option", { name: "Ground beef", exact: true }).click();
  await page.getByRole("textbox", { name: /amount/i }).fill("250");
  await page.getByRole("textbox", { name: "Cook time (min)" }).fill("20");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
  await dismissToasts(page);

  await goTo(page, "Plan");
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Generate week" }).click();

  const notifications = page.getByRole("region", { name: "Notifications" });
  await expect(notifications.getByText(/6 slots still empty/i)).toBeVisible();
  await expect(notifications.getByText(/Filled 1 of 7 empty slot/i)).toBeVisible();
  await expect(notifications.getByText(/Dinner/)).toBeVisible();
});
