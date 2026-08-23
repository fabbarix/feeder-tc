import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { dismissToasts } from "./support/toast.ts";

// UA review finding #3a: "Generate week" used to fill whatever it could and
// say NOTHING — no recipe tagged for a meal at all silently left the whole
// week empty with no clue why. This asserts what the person actually sees:
// a notification naming how many slots got filled and why the rest didn't,
// not an internal counter. Fails on `origin/main` (a367ab3) because that
// build fires no toast for "Generate week" at all — see `usePlanWeek.ts`'s
// old "no success toast" comment, which covered the EMPTY-result case too,
// not just the full-success one this finding leaves alone.
//
// WP-leftover-planning note: this used to exercise a SMALL library (one
// dinner recipe) rather than a recipe-less one, and asserted 6 of 7 slots
// stayed empty. That stopped being true once the generator's own
// no-repeat-rule fallback shipped (generator.ts step 5, owner decision: "the
// no-repeat rule gives way rather than leaving a week unfilled") — one
// dinner recipe now fills all seven nights by repeating it, which is the
// correct, intended behaviour, not a regression. The only way left to
// genuinely starve a meal tag is zero recipes tagged for it at all, which is
// what this test exercises now.

function goTo(page: Page, label: string) {
  return page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: label }).click();
}

test("generating a week with zero dinner recipes says how many slots filled and why the rest stayed empty", async ({
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

  // No recipe tagged Dinner at all (tagged Breakfast instead, which this
  // household no longer has any slots for) — zero eligible candidates for
  // every one of the week's 7 dinner slots, a genuine starved-tag case, not
  // the small-library one the repeat fallback would now quietly fill.
  await goTo(page, "Recipes");
  await page.getByRole("link", { name: /Add recipe|New recipe/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Only Breakfast");
  await page.getByRole("group", { name: "Meal tags" }).getByRole("button", { name: "Breakfast" }).click();
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
  await expect(notifications.getByText(/7 slots still empty/i)).toBeVisible();
  await expect(notifications.getByText(/Filled 0 of 7 empty slot/i)).toBeVisible();
  await expect(notifications.getByText(/Dinner/)).toBeVisible();
});
