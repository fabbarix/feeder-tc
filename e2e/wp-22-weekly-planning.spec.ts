import { expect, test, type Locator, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// IMPLEMENTATION_PLAN.md WP-22, `@e2e`:
//
// Feature: Weekly planning
//   Scenario: Generating and adjusting a week
//     Given staples and rotation recipes exist
//     When the user generates next week
//     Then every configured slot is filled respecting meal tags
//     When they pin Tuesday's dinner and reroll Wednesday's dinner
//     Then Tuesday is unchanged and Wednesday differs from its previous recipe
//
//   Scenario: Mark cooked deducts pantry and creates leftovers
//     Given Tuesday's dinner "Chili" is scaled to 8 servings for a household of 4
//     When the user marks it cooked and confirms suggested amounts
//     Then usage events are appended for each ingredient FIFO
//     And a "Leftover: Chili" lot of 4 portions appears in the pantry
//     And "Chili" appears in cooked history

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function nav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Primary" });
}

async function goTo(page: Page, label: string): Promise<void> {
  await nav(page).getByRole("link", { name: label }).click();
}

/**
 * Clears every currently-shown toast (`src/ui/components/Toast`). On the
 * narrow mobile-chrome viewport the toast viewport's fixed bottom band can
 * sit directly over a form's submit button, and this spec creates recipes
 * back-to-back — without this, the next `Save recipe` click intermittently
 * lands on a still-visible "Saved ..." toast instead (Playwright's
 * actionability check reports the toast intercepting pointer events). Real
 * usage never fires this many toasts within a five-second window; this is
 * a test-speed artifact, not a product bug, so it's worked around here
 * rather than in `src/ui/components/Toast` (shared kit, out of WP-22 scope).
 */
async function dismissToasts(page: Page): Promise<void> {
  const dismissButtons = page.getByRole("region", { name: "Notifications" }).getByRole("button");
  while ((await dismissButtons.count()) > 0) {
    await dismissButtons.first().click();
  }
}

/** Removes one slot chip from the Settings slot-layout editor and waits for the removal to land before returning — DaySlotEditor.tsx's `removeSlot` is a real async write (WorkbookStore.settings.write), so two rapid removals without this would race against the same stale `settings` snapshot. */
async function removeSlotChip(page: Page, day: string, tag: string): Promise<void> {
  const button = page.getByRole("button", { name: `Remove ${tag} on ${day}` });
  await button.click();
  await expect(button).toHaveCount(0);
}

/** Trims the default breakfast/lunch/dinner-every-day layout down to dinner-only, for every day. */
async function makeDinnerOnly(page: Page): Promise<void> {
  await goTo(page, "Settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  for (const day of DAYS) {
    await removeSlotChip(page, day, "Breakfast");
    await removeSlotChip(page, day, "Lunch");
  }
}

interface AddRecipeOptions {
  readonly staple?: boolean;
  readonly ingredient?: { readonly name: string; readonly amount: string };
}

/** Creates a dinner recipe (cooked kind) via the recipe editor, matching e2e/wp-vc-visual-conformance.spec.ts's `addRecipe` helper plus meal-tag/household-flag/ingredient-line steps WP-22 needs. */
async function addDinnerRecipe(
  page: Page,
  name: string,
  options: AddRecipeOptions = {},
): Promise<void> {
  await goTo(page, "Recipes");
  await page.getByRole("link", { name: /Add recipe|New recipe/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page
    .getByRole("group", { name: "Meal tags" })
    .getByRole("button", { name: "Dinner" })
    .click();
  if (options.staple) {
    await page
      .getByRole("radiogroup", { name: "Household flag" })
      .getByRole("radio", { name: "Staple" })
      .click();
  }
  if (options.ingredient) {
    await page.getByRole("button", { name: "Add ingredient line" }).click();
    await page.getByRole("button", { name: /^Ingredient/i }).click();
    await page.getByRole("option", { name: options.ingredient.name, exact: true }).click();
    await page.getByRole("textbox", { name: /amount/i }).fill(options.ingredient.amount);
  }
  await page.getByRole("textbox", { name: "Cook time (min)" }).fill("20");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
  await dismissToasts(page);
}

/** The visible (desktop grid or mobile day-card, whichever the viewport shows) container for one day, found via its `<h2>` day-label heading — `getByRole` only matches the heading that's actually in the accessibility tree, so this resolves correctly on both Playwright projects (chromium: the desktop grid; mobile-chrome: the day-card list — see plan.module.css's `display:none` breakpoints). */
function dayCard(page: Page, dayShort: string): Locator {
  const heading = page.getByRole("heading", { name: new RegExp(`^${dayShort} \\d+`) });
  return heading.locator("xpath=..");
}

test.describe.configure({ mode: "serial" });

test("Generating and adjusting a week", async ({ page }) => {
  await enterReadyShell(page, "settings");

  // Given staples and rotation recipes exist — dinner-only layout (7 slots)
  // and exactly 8 dinner recipes (2 staples + 6 rotation) makes "every slot
  // filled" deterministic regardless of the generator's Rng seed: 2 staples
  // cover the first two chronological days, and the 6-recipe rotation pool
  // covers the remaining 5 slots with one recipe to spare — the spare is
  // what guarantees "Wednesday differs from its previous recipe" below has
  // a real alternative to reroll onto, not just the recipe it started with.
  await makeDinnerOnly(page);
  await addDinnerRecipe(page, "Sunday Roast", { staple: true });
  await addDinnerRecipe(page, "Fish Pie", { staple: true });
  await addDinnerRecipe(page, "Carbonara");
  await addDinnerRecipe(page, "Roast Chicken");
  await addDinnerRecipe(page, "Store Lasagna");
  await addDinnerRecipe(page, "Tomato Salad");
  await addDinnerRecipe(page, "Beef Stew");
  await addDinnerRecipe(page, "Veggie Curry");

  // When the user generates next week
  await goTo(page, "Plan");
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Generate week" }).click();

  // Then every configured slot is filled respecting meal tags — no "Pick a
  // meal" affordance left anywhere, and only dinner-tagged recipes appear
  // (guaranteed by construction: every recipe created above is dinner-only).
  await expect(page.getByRole("button", { name: /Pick a meal/ })).toHaveCount(0);

  // Staples land on the first two chronological days in creation order
  // (generator.ts's `advanceStaples`, fed `candidatesForSlot(..., ["staple"])`
  // in recipe-list order) — Monday gets "Sunday Roast", Tuesday gets "Fish
  // Pie". Asserting Tuesday's starting recipe by name, not by reading it
  // back, is what makes the pin/reroll comparison below meaningful.
  const tuesday = dayCard(page, "Tue");
  const wednesday = dayCard(page, "Wed");
  await expect(tuesday.getByRole("button", { name: "Fish Pie", exact: true })).toBeVisible();

  const wednesdayNameBefore = await wednesday.locator('[class*="slotNameButton"]').innerText();

  // When they pin Tuesday's dinner and reroll Wednesday's dinner
  await tuesday.getByRole("button", { name: "Pin" }).click();
  await expect(tuesday.getByRole("button", { name: "Unpin" })).toBeVisible();

  await wednesday.getByRole("button", { name: "Reroll" }).click();

  // Then Tuesday is unchanged and Wednesday differs from its previous recipe
  await expect(tuesday.getByRole("button", { name: "Fish Pie", exact: true })).toBeVisible();
  await expect(wednesday.locator('[class*="slotNameButton"]')).not.toHaveText(wednesdayNameBefore);
});

test("Mark cooked deducts pantry and creates leftovers", async ({ page }) => {
  await enterReadyShell(page, "settings");

  // Household of 4 (default is 2 — HANDOVER.md/bootstrap.ts DEFAULT_SETTINGS).
  await page.getByRole("button", { name: "More — Size" }).click();
  await page.getByRole("button", { name: "More — Size" }).click();
  await expect(page.getByText("4 people")).toBeVisible();

  await addDinnerRecipe(page, "Chili", { ingredient: { name: "Ground beef", amount: "250" } });

  // Enough pantry stock that the FIFO usage event has somewhere to draw from.
  await goTo(page, "Pantry");
  await expect(page.getByRole("heading", { name: "Pantry", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await page.getByRole("button", { name: /ingredient/i }).click();
  await page.getByRole("option", { name: "Ground beef", exact: true }).click();
  await page.getByRole("textbox", { name: /amount/i }).fill("1000");
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await expect(page.getByRole("main")).toContainText("1000 g");
  await dismissToasts(page);

  // Given Tuesday's dinner "Chili" is scaled to 8 servings for a household of 4
  await goTo(page, "Plan");
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
  const tuesday = page.getByRole("heading", { name: /^Tue \d+/ }).locator("xpath=..");
  await tuesday.getByRole("button", { name: "Pick a meal for Dinner" }).click();
  await page.getByRole("button", { name: "Chili", exact: true }).click();

  for (let target = 5; target <= 8; target += 1) {
    await tuesday.getByRole("button", { name: "More servings for Chili" }).click();
    await expect(tuesday.locator('[class*="scaleBadge"]')).toHaveText(`${target} servings`);
  }

  // When the user marks it cooked and confirms suggested amounts
  await tuesday.getByRole("button", { name: "Cook" }).click();
  await expect(page.getByRole("heading", { name: 'Mark "Chili" cooked' })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Ground beef/ })).toHaveValue("500");
  await page.getByRole("button", { name: "Mark cooked" }).click();
  await expect(page.getByRole("heading", { name: 'Mark "Chili" cooked' })).toHaveCount(0);
  await dismissToasts(page);

  // Then usage events are appended for each ingredient FIFO — the 1000 g
  // Ground beef lot drops by the scaled 500 g (250 g at 4 servings x2).
  await goTo(page, "Pantry");
  await expect(page.getByRole("main")).toContainText("500 g");

  // And a "Leftover: Chili" lot of 4 portions appears in the pantry — as
  // its own aggregated row (WP-VC4: one row per ingredient, linking to its
  // own pantry-item detail route), not a per-ingredient heading the way
  // the pantry used to group its old one-row-per-LOT list.
  await expect(page.getByRole("link", { name: /Leftover: Chili/ })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("4 portion");

  // And "Chili" appears in cooked history
  await goTo(page, "Recipes");
  await page.getByRole("link", { name: /Chili/ }).click();
  // Assert the cooked-history line itself, which is what this scenario is
  // about. The previous assertion looked for the lowercase word "dinner",
  // which only ever matched incidental text on the old always-editable
  // recipe form; WP-VC2 split that into a read view where the meal tag is a
  // capitalised "Dinner" pill. Asserting incidental copy made this test
  // pass for the wrong reason and then fail for the wrong reason.
  await expect(page.getByRole("main")).toContainText(/Cooked \d+ time/i);
  await expect(page.getByRole("main")).not.toContainText("Not marked cooked yet");
});
