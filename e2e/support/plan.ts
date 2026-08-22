import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Support helpers for the Plan calendar E2E suite (month/quarter views,
 * Today button, per-slot Remove). Deliberately self-contained rather than
 * reused from elsewhere: at the time this was written there was no
 * `e2e/support/plan.ts` in this branch yet — see the PR report for the
 * expected, flagged overlap with `wp-journey`'s own version of some of
 * these helpers once that branch merges.
 */

/** A minimal dinner-tagged recipe — name and meal tag only, no ingredient lines (the mark-cooked dialog handles a recipe with zero lines fine: "confirming just records it as cooked"). */
export async function addDinnerRecipe(page: Page, name: string): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipes", exact: true }).click();
  await page.getByRole("link", { name: /Add recipe|New recipe/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("group", { name: "Meal tags" }).getByRole("button", { name: "Dinner" }).click();
  await page.getByRole("textbox", { name: "Cook time (min)" }).fill("20");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
}

export async function goToPlan(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
}

/**
 * The visible day container (desktop 7-column grid or mobile stacked day
 * card — `PlanSlotRow.tsx`'s "shared markup" between both; `Plan.tsx`
 * renders both DOM subtrees and CSS hides one per viewport, so
 * `getByRole` only ever matches the one actually in the accessibility
 * tree at the current viewport), found via its `<h2>` day-label heading —
 * same technique `e2e/wp-22-weekly-planning.spec.ts` already uses.
 */
export function dayCard(page: Page, dayShort: string): Locator {
  const heading = page.getByRole("heading", { name: new RegExp(`^${dayShort} \\d+`) });
  return heading.locator("xpath=..");
}

const DAY_SHORT: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Today's `Mon`/`Tue`/... abbreviation — E2E runs against the real system clock (`systemClock`), not a fixed one, so this is computed at run time rather than hard-coded. */
export function todayShortLabel(): string {
  return DAY_SHORT[new Date().getDay()]!;
}

export function todayCard(page: Page): Locator {
  return dayCard(page, todayShortLabel());
}

/** Fills an EMPTY slot by clicking its "Pick a meal for {tag}" button, then the named recipe in the picker. */
export async function pickMealForEmptySlot(page: Page, day: Locator, mealTag: string, recipeName: string): Promise<void> {
  await day.getByRole("button", { name: `Pick a meal for ${mealTag}` }).click();
  await page.getByRole("button", { name: recipeName, exact: true }).click();
}

export async function markSlotCooked(page: Page, day: Locator, recipeName: string): Promise<void> {
  await day.getByRole("button", { name: "Cook", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Mark "${recipeName}" cooked` })).toBeVisible();
  await page.getByRole("button", { name: "Mark cooked" }).click();
  await expect(page.getByRole("heading", { name: `Mark "${recipeName}" cooked` })).toHaveCount(0);
}

/**
 * Clicks a day's "Remove from plan" icon and returns the confirm dialog
 * locator, WITHOUT confirming — callers assert on the dialog's copy
 * (design/mock-responsive.html's two variants) before deciding whether to
 * confirm or cancel.
 */
export async function openRemoveConfirm(page: Page, day: Locator): Promise<Locator> {
  await day.getByRole("button", { name: "Remove from plan" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function confirmRemove(dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Remove from plan" }).click();
  await expect(dialog).toHaveCount(0);
}
