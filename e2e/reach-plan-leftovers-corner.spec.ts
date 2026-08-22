import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { addDinnerRecipe, bumpServings, dayCard, goToPlan, markSlotCooked, pickMealForEmptySlot } from "./support/plan.ts";

// Tablet round-2 review: the weekend band's 4th `.week4` cell (Mon-Thu is
// full at four real days; Fri-Sun only has three, so the band needed a
// filler to keep all four columns the same width — see plan.module.css's
// own comment on `.week4`) used to be a bare `aria-hidden` div, matching
// design/mock-responsive.html exactly. That read as a missing column rather
// than deliberate space, so the owner asked for real content there:
// leftovers at risk this week, soonest-expiry-first, capped rather than
// left to grow unbounded (`.week4` uses `align-items: start` specifically
// so one tall cell can't inflate its whole band — LeftoversAtRiskCard.tsx's
// own doc comment has the full reasoning). Only the 768-1439px tablet tier
// ever shows this band at all (`.week` takes over as a plain 7-column row
// at >=1440px, `.dayList` below 768px — see reach-plan-tablet-layout.spec.ts),
// so every test here runs at a tablet viewport.

const TABLET_VIEWPORT = { width: 1024, height: 1366 };

function leftoversCard(page: import("@playwright/test").Page) {
  return page.getByRole("heading", { name: "Leftovers" }).locator("xpath=..");
}

test("weekend corner card shows a reassuring empty state, not a blank panel, and stays as short as the day cards beside it", async ({
  page,
}) => {
  await page.setViewportSize(TABLET_VIEWPORT);
  await enterReadyShell(page, "recipes");
  await goToPlan(page);

  await expect(page.getByText("Fri – Sun")).toBeVisible();
  const card = leftoversCard(page);
  await expect(card).toBeVisible();
  // Never impersonates a weekday: its own heading names the card, distinct
  // from the "Fri N"/"Sat N"/"Sun N" day headings beside it.
  await expect(page.getByRole("heading", { name: /^Fri \d+/ })).toBeVisible();
  await expect(card.getByText("Nothing at risk this week")).toBeVisible();

  // With nothing to show, the card is short — nowhere near the ~380px a
  // stretched/inflated cell hit in the tablet UX review's original bug
  // (plan.module.css's `.week4` comment). A generous cap, not a tight
  // pixel match: this just confirms the empty state doesn't itself balloon.
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height, "empty leftovers card should be short, matching a quiet day card").toBeLessThan(150);
});

test("a fresh leftover from marking a meal cooked appears in the weekend corner card and links to its pantry detail", async ({
  page,
}) => {
  await page.setViewportSize(TABLET_VIEWPORT);
  await enterReadyShell(page, "settings");

  // Household of 4 (default is 2) so scaling up creates a surplus to save
  // as a leftover — same setup as e2e/wp-22-weekly-planning.spec.ts's own
  // "Mark cooked deducts pantry and creates leftovers" scenario.
  await page.getByRole("button", { name: "More — Size" }).click();
  await page.getByRole("button", { name: "More — Size" }).click();
  await expect(page.getByText("4 people")).toBeVisible();

  await addDinnerRecipe(page, "Chili");
  await goToPlan(page);

  const tuesday = dayCard(page, "Tue");
  await pickMealForEmptySlot(page, tuesday, "Dinner", "Chili");
  await bumpServings(tuesday, "Chili", 4); // 4 -> 8 servings, surplus 4 for a household of 4.
  await markSlotCooked(page, tuesday, "Chili");

  // The leftover lot is dated from today with a 4-day fridge shelf life
  // (LEFTOVER_FRIDGE_SHELF_LIFE_DAYS, src/data/seed-catalog.ts) regardless
  // of which week is on screen when it's cooked. `deriveLeftoversAtRisk`
  // windows "at risk" to the WEEK CURRENTLY BEING VIEWED (same convention
  // as `computeExpiringIngredientIds`, plan-derive.ts) — so whether that
  // expiry lands inside the week already on screen depends on today's real
  // weekday when this suite happens to run. Compute that here instead of
  // assuming: at most one "Next week" click is ever needed, since a 4-day
  // shelf life can overshoot a 7-day window by at most one week.
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7; // days since this week's Monday (Mon=0..Sun=6)
  const needsNextWeek = mondayOffset + 4 > 6;
  if (needsNextWeek) {
    await page.getByRole("button", { name: "Next week" }).click();
  }

  const card = leftoversCard(page);
  await expect(card).toBeVisible();
  const entryLink = card.getByRole("link", { name: /Leftover: Chili/ });
  await expect(entryLink).toBeVisible();
  await expect(entryLink).toContainText("4 portions");

  // Clicking it goes to that leftover ingredient's own pantry detail route
  // — "the lot's detail", the same destination Pantry's own aggregated row
  // uses (Pantry.tsx's `Link to={`/pantry/${id}`}`).
  await entryLink.click();
  await expect(page).toHaveURL(/\/pantry\/.+/);
  await expect(page.getByRole("heading", { name: "Leftover: Chili" })).toBeVisible();
});
