import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { dayCard, goToPlan, pickMealForEmptySlot } from "./support/plan.ts";
import { addRichCookedRecipe } from "./support/recipes.ts";

// Targeted reachability/behaviour checks for Plan that
// `journey-household-week.spec.ts` cannot naturally exercise in one linear
// session, at every tier where relevant.

test.describe("The servings scale stepper is reachable at every tier", () => {
  // design/mock-responsive.html states twice, explicitly, that "the servings
  // stepper is phone-only" (§ owner request). The shipped code has NO
  // viewport gating on it at all (grepped plan.module.css and
  // PlanSlotRow.tsx end to end) — it renders identically inside both the
  // desktop 7-column grid and the mobile day-card list. This locks in
  // TODAY'S actual behaviour (reachable everywhere) rather than the mock's
  // stated-but-unbuilt intent — flagged to the owner as a mock/build
  // mismatch in this suite's report, not something this PR resolves.
  for (const tier of [
    { name: "phone", width: 390, height: 844 },
    { name: "tablet", width: 1024, height: 1366 },
    { name: "desktop", width: 1512, height: 950 },
  ] as const) {
    test(`${tier.name} (${tier.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: tier.width, height: tier.height });
      await enterReadyShell(page, "recipes");
      await addRichCookedRecipe(page, "Reach-plan dinner", { mealTags: ["Dinner"], cookMinutes: 15 });

      await goToPlan(page);
      const day = dayCard(page, "Mon");
      await pickMealForEmptySlot(page, day, "Dinner", "Reach-plan dinner");
      const more = day.getByRole("button", { name: "More servings for Reach-plan dinner" });
      await expect(more, `scale stepper not reachable at ${tier.width}px`).toBeVisible();
      await more.click();
      await expect(day.locator('[class*="scaleBadge"]')).toBeVisible();
    });
  }
});

test("Clearing a PAST slot has no confirmation step of any kind — the design mock's proposed 'past-slot confirm' does not exist in the app", async ({
  page,
}) => {
  // The app's only "remove from plan" affordance is `RecipePickerDialog`'s
  // "Clear this slot" (there is no dedicated Remove icon, unlike
  // design/mock-responsive.html's proposal of one on every filled slot,
  // "including past ones"). `usePlanWeek.ts`'s `clearSlot` fires
  // immediately with no confirm dialog and no date check of any kind — this
  // test proves that by clearing a slot dated in the PAST (last week,
  // reached via WeekNav's real "Previous week" click, never `page.goto`)
  // and observing it empties on the FIRST click, with no intermediate
  // "Are you sure?" step. Reported as a gap, not fixed here (frozen scope).
  await enterReadyShell(page, "recipes");
  await addRichCookedRecipe(page, "Reach-plan past dinner", { mealTags: ["Dinner"], cookMinutes: 15 });

  await goToPlan(page);
  await page.getByRole("button", { name: "Previous week" }).click();
  const monday = dayCard(page, "Mon");
  await pickMealForEmptySlot(page, monday, "Dinner", "Reach-plan past dinner");
  await expect(monday.getByRole("button", { name: "Reach-plan past dinner", exact: true })).toBeVisible();

  await monday.getByRole("button", { name: "Reach-plan past dinner", exact: true }).click();
  const clearButton = page.getByRole("button", { name: "Clear this slot" });
  await expect(clearButton).toBeVisible();
  await clearButton.click();
  // No confirm dialog appears in between — the slot is already empty.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(monday.getByRole("button", { name: "Pick a meal for Dinner" })).toBeVisible();
});

test("today's slot carries a '· tonight' text marker — the app's ONLY 'today' indicator, no day-level highlight exists", async ({
  page,
}) => {
  // design/mock-responsive.html proposes an accent-tinted day cell at every
  // tier, matching the month/quarter view's own "today" dot. The actual
  // `Plan.tsx`/`plan.module.css` carry no such class or `aria-current` at
  // all — `PlanSlotRow.tsx`'s badge text is the entire mechanism
  // (`plan-derive.ts`'s `view.isToday`).
  await enterReadyShell(page, "recipes");
  await addRichCookedRecipe(page, "Reach-plan today dinner", { mealTags: ["Dinner"], cookMinutes: 15 });
  await goToPlan(page);
  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = dayCard(page, DAY_SHORT[new Date().getDay()]!);
  await pickMealForEmptySlot(page, today, "Dinner", "Reach-plan today dinner");
  await expect(today).toContainText("tonight");
  await expect(today.getByRole("heading")).not.toHaveAttribute("aria-current", /.*/);
});

test.fixme(
  "Month view — not implemented (Plan.tsx has no view-mode toggle at any tier; design/mock-responsive.html proposes a density-view month calendar with a dot per day)",
  async () => {},
);

test.fixme(
  "Quarter view — not implemented (same gap as the month view above)",
  async () => {},
);

test.fixme(
  "A 'Today' shortcut button in the week navigation — not implemented (WeekNav.tsx is previous/next chevrons + a label only; every tier in design/mock-responsive.html proposes a 'Today' ghost button beside it, so after navigating away there is no one-tap way back to the current week)",
  async () => {},
);
