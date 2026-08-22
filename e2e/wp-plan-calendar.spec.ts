import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import {
  addDinnerRecipe,
  confirmRemove,
  dayCard,
  goToPlan,
  markSlotCooked,
  openRemoveConfirm,
  pickMealForEmptySlot,
  todayCard,
} from "./support/plan.ts";

// The calendar half of the owner-approved Plan mock (PR #31), never
// dispatched to an implementation package — see design/mock-responsive.html
// § "Plan", § "Removing a plan entry", and § "Month — an overview, not an
// editor". Every scenario below is reached by clicking through the UI
// (WeekNav, the Week/Month toggle, the picker dialog) — never `page.goto` to
// a deep route, which is exactly how the whole month/quarter/Today gap went
// unnoticed for as long as it did.
//
// Run at all three tiers the owner asked for: phone (390), tablet (1024),
// desktop (1512) — same tier list/shape as e2e's other per-tier reachability
// suites (e.g. the wp-journey reach-plan spec).
const TIERS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "desktop", width: 1512, height: 950 },
] as const;

for (const tier of TIERS) {
  test.describe(`Plan calendar — ${tier.name} (${tier.width}px)`, () => {
    test.use({ viewport: { width: tier.width, height: tier.height } });

    test("today's day card gets a visual highlight, not just the '· tonight' text badge", async ({ page }) => {
      await enterReadyShell(page, "recipes");
      await addDinnerRecipe(page, "Tonight's Dinner");
      await goToPlan(page);

      const today = todayCard(page);
      await pickMealForEmptySlot(page, today, "Dinner", "Tonight's Dinner");

      await expect(today).toContainText("tonight");
      // The visual treatment (design mock's accent-line/accent-bg pair,
      // same as the month/quarter dot) — not just the text marker that was
      // the app's ONLY "today" indicator before this package.
      await expect(today).toHaveAttribute("class", /dayToday|dayCardToday/);
    });

    test("a past day shows a Cooked status instead of Cook/Reroll/Pin", async ({ page }) => {
      await enterReadyShell(page, "recipes");
      await addDinnerRecipe(page, "Already Cooked Dinner");
      await goToPlan(page);

      await page.getByRole("button", { name: "Previous week" }).click();
      const monday = dayCard(page, "Mon");
      await pickMealForEmptySlot(page, monday, "Dinner", "Already Cooked Dinner");
      await markSlotCooked(page, monday, "Already Cooked Dinner");

      await expect(monday.getByText("Cooked", { exact: true })).toBeVisible();
      await expect(monday.getByRole("button", { name: "Cook" })).toHaveCount(0);
      await expect(monday.getByRole("button", { name: "Reroll" })).toHaveCount(0);
      await expect(monday.getByRole("button", { name: "Pin" })).toHaveCount(0);
      // "read as status, not a disabled button" — no inert Cook button sits
      // there inviting a tap that does nothing.
      await expect(monday.getByRole("button", { name: "Cook", disabled: true })).toHaveCount(0);
    });

    test("Remove is reachable on a filled future slot, and a one-sentence confirm is enough", async ({ page }) => {
      await enterReadyShell(page, "recipes");
      await addDinnerRecipe(page, "Future Dinner");
      await goToPlan(page);

      const today = todayCard(page);
      await pickMealForEmptySlot(page, today, "Dinner", "Future Dinner");
      await expect(today.getByRole("button", { name: "Future Dinner", exact: true })).toBeVisible();

      const dialog = await openRemoveConfirm(page, today);
      await expect(dialog).toContainText("Nothing's been cooked yet");
      await expect(dialog).not.toContainText("doesn’t undo the cooking");

      await confirmRemove(dialog);
      await expect(today.getByRole("button", { name: "Pick a meal for Dinner" })).toBeVisible();
    });

    test("Remove on a past, already-cooked slot explains that it corrects the plan without undoing the cooking", async ({
      page,
    }) => {
      await enterReadyShell(page, "recipes");
      await addDinnerRecipe(page, "Past Cooked Dinner");
      await goToPlan(page);

      await page.getByRole("button", { name: "Previous week" }).click();
      const monday = dayCard(page, "Mon");
      await pickMealForEmptySlot(page, monday, "Dinner", "Past Cooked Dinner");
      await markSlotCooked(page, monday, "Past Cooked Dinner");

      const dialog = await openRemoveConfirm(page, monday);
      await expect(dialog).toContainText("Monday has already passed");
      await expect(dialog).toContainText("doesn’t undo the cooking");
      await expect(dialog).toContainText("Past Cooked Dinner");

      await confirmRemove(dialog);
      // Corrected back to plannable — not stranded as an empty "cooked" row.
      await expect(monday.getByRole("button", { name: "Pick a meal for Dinner" })).toBeVisible();
    });

    test("the Today button returns to the current week after navigating away", async ({ page }) => {
      await enterReadyShell(page, "recipes");
      await addDinnerRecipe(page, "Marker Dinner");
      await goToPlan(page);

      const today = todayCard(page);
      await pickMealForEmptySlot(page, today, "Dinner", "Marker Dinner");
      await expect(today.getByRole("button", { name: "Marker Dinner", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Next week" }).click();
      await page.getByRole("button", { name: "Next week" }).click();
      await expect(page.getByText("Marker Dinner")).toHaveCount(0);

      await page.getByRole("button", { name: "Today" }).click();
      await expect(todayCard(page).getByRole("button", { name: "Marker Dinner", exact: true })).toBeVisible();
    });

    test("Month view is reachable via the Week/Month toggle and shows a density grid", async ({ page }) => {
      await enterReadyShell(page, "recipes");
      await goToPlan(page);

      await page.getByRole("radio", { name: "Month" }).click();
      // A month heading ("<Month> <Year>"), not a week range.
      await expect(page.getByText(/^[A-Z][a-z]+ \d{4}$/)).toBeVisible();
      // Density dots, no recipe text — at least one day cell reachable by
      // its date, clickable to open that week.
      const cells = page.getByRole("button", { name: /open this week/ });
      await expect(cells.first()).toBeVisible();
      expect(await cells.count()).toBeGreaterThanOrEqual(28);
    });

    test("Quarter (three months, same component at lower density) shows beneath the month grid, and clicking a day opens its week", async ({
      page,
    }) => {
      await enterReadyShell(page, "recipes");
      await addDinnerRecipe(page, "Quarter Click Dinner");
      await goToPlan(page);

      await page.getByRole("radio", { name: "Month" }).click();
      // Assert the heading by ROLE and its user-facing name, not by a literal
      // sentence. This previously pinned "Quarter — same component, lower
      // density" — a note about reusing one calendar component at two
      // densities, which had been shipped as a user-visible <h2>. The test
      // cemented it, so removing the jargon broke CI rather than the jargon
      // being caught for what it was.
      await expect(page.getByRole("heading", { name: "Quarter", exact: true })).toBeVisible();

      // Three distinct month labels in the quarter strip.
      const monthNow = new Date();
      const monthNames = [0, 1, 2].map((offset) =>
        new Date(Date.UTC(monthNow.getFullYear(), monthNow.getMonth() + offset, 1)).toLocaleString("en-US", {
          month: "long",
          timeZone: "UTC",
        }),
      );
      for (const name of monthNames) {
        await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      }

      // Clicking today's cell (present in both the main month grid and the
      // quarter's own mini-grid for the current month) opens that week —
      // the main grid's is first in the DOM.
      await page.getByRole("button", { name: /\(today\)/ }).first().click();
      await expect(page.getByRole("radio", { name: "Week" })).toBeChecked();
      await expect(todayCard(page)).toBeVisible();
    });
  });
}
