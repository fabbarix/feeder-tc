import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { addDinnerRecipe, dayCard, goToPlan, pickMealForEmptySlot } from "./support/plan.ts";

// Tablet UI/UX review, findings 1 and 2: at 1024px (seven columns / 134.9px
// each) a normal recipe name wrapped three lines and the 30x30px icon
// buttons (reroll/pin/remove) were the only place in the app ignoring its
// own --touch-target standard. design/mock-responsive.html's Plan tier note
// is the approved fix: four columns, banded Mon-Thu / Fri-Sun, both bands
// sharing the identical 4-track grid — see Plan.tsx/plan.module.css's own
// comments for the full reasoning (why not a scroll strip, why not
// auto-fill/minmax). This spec pins the MECHANISM (exactly two 4-column
// grids at tablet, the desktop 7-column grid and mobile day-list both
// absent from the accessibility tree there, and 48px icon buttons that fit
// without overlapping) rather than a screenshot, so a future regression
// fails a specific assertion.
//
// Every control below is reached by clicking through the real UI (primary
// nav, WeekNav, the picker dialog) — never `page.goto` to `/plan` directly.

/**
 * Finds the `.week` (desktop 7-col), `.weekBands` (tablet, banded 4-col)
 * and `.dayList` (mobile) containers by their OWN class name, distinct from
 * each other despite all being CSS-module-hashed and all containing the
 * substring "week" for two of the three (`weekBands`/`week4`/`weekBand` all
 * contain "week") — hence the explicit `weekBand`/`week4` exclusion on the
 * desktop grid lookup, done here in one `page.evaluate` round-trip rather
 * than juggling ambiguous Playwright locator substrings.
 */
async function planLayoutState(page: Page): Promise<{
  readonly weekVisible: boolean;
  readonly weekBandsVisible: boolean;
  readonly dayListVisible: boolean;
  readonly week4ColumnCounts: readonly number[];
}> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>("main [class]"));
    const has = (el: HTMLElement, substr: string) => Array.from(el.classList).some((c) => c.includes(substr));
    const isVisible = (el: HTMLElement | undefined) => (el ? getComputedStyle(el).display !== "none" : false);

    const weekEl = all.find((el) => has(el, "week") && !has(el, "weekBand") && !has(el, "week4"));
    const weekBandsEl = all.find((el) => has(el, "weekBands"));
    const dayListEl = all.find((el) => has(el, "dayList"));
    const week4Els = all.filter((el) => has(el, "week4"));

    return {
      weekVisible: isVisible(weekEl),
      weekBandsVisible: isVisible(weekBandsEl),
      dayListVisible: isVisible(dayListEl),
      week4ColumnCounts: week4Els.map((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
    };
  });
}

test.describe("Plan week — tablet four-column banded grid (tablet UI/UX review, finding 1)", () => {
  test("tablet (1024px): exactly two 4-column bands render; the desktop 7-column grid and mobile day-list are both absent", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 1366 });
    await enterReadyShell(page, "recipes");
    await addDinnerRecipe(page, "Sam's Genuinely Very Stuffed Peppers");
    await goToPlan(page);

    // `usePlanWeek` fetches asynchronously (Skeletons first) — wait for a
    // real day heading before reading layout, or the check below races the
    // loading state and finds none of `.week`/`.weekBands`/`.dayList`
    // mounted yet.
    const monday = dayCard(page, "Mon");
    await pickMealForEmptySlot(page, monday, "Dinner", "Sam's Genuinely Very Stuffed Peppers");

    const state = await planLayoutState(page);
    expect(state.weekVisible, "desktop 7-column .week should be hidden at tablet width").toBe(false);
    expect(state.dayListVisible, "mobile .dayList should be hidden at tablet width").toBe(false);
    expect(state.weekBandsVisible, "tablet .weekBands should be visible").toBe(true);
    expect(state.week4ColumnCounts, "both weekday and weekend bands share one 4-track grid").toEqual([4, 4]);

    // "Mon - Thu" / "Fri - Sun" band labels (mock's own grouping), reached
    // by their visible text, not an internal class name.
    await expect(page.getByText("Mon – Thu")).toBeVisible();
    await expect(page.getByText("Fri – Sun")).toBeVisible();

    // A long recipe name still fits without ballooning to three lines
    // (the reported defect at seven columns/134.9px): two lines of the
    // slot-name font (0.95rem/1.2 line-height) is ~41px at this app's
    // 18px root font-size; three would be ~61px. Generous upper bound
    // below (56px) tolerates padding/rounding while still failing on a
    // real three-line wrap.
    const nameButton = monday.getByRole("button", { name: "Sam's Genuinely Very Stuffed Peppers", exact: true });
    await expect(nameButton).toBeVisible();
    const nameHeight = await nameButton.evaluate((el) => el.getBoundingClientRect().height);
    expect(nameHeight, "recipe name should wrap at most two lines, not three").toBeLessThan(56);
  });

  test("phone (390px) keeps the stacked day-card list, unaffected by the tablet band", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterReadyShell(page, "recipes");
    await goToPlan(page);
    await expect(page.getByRole("heading", { name: /^Mon \d+/ })).toBeVisible();

    const state = await planLayoutState(page);
    expect(state.dayListVisible).toBe(true);
    expect(state.weekVisible).toBe(false);
    expect(state.weekBandsVisible).toBe(false);
  });

  test("desktop (1512px) keeps the seven-column grid, unaffected by the tablet band", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 950 });
    await enterReadyShell(page, "recipes");
    await goToPlan(page);
    await expect(page.getByRole("heading", { name: /^Mon \d+/ })).toBeVisible();

    const state = await planLayoutState(page);
    expect(state.weekVisible).toBe(true);
    expect(state.weekBandsVisible).toBe(false);
    expect(state.dayListVisible).toBe(false);
  });
});

test.describe("Plan icon buttons meet the 48px touch-target standard (tablet UI/UX review, finding 2)", () => {
  for (const edge of [
    { name: "tablet's narrow end", width: 768, height: 1024 },
    { name: "tablet's wide end", width: 1439, height: 900 },
  ] as const) {
    test(`${edge.name} (${edge.width}px): reroll/pin/remove are 48x48px and stay inside their day card`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: edge.width, height: edge.height });
      await enterReadyShell(page, "recipes");
      await addDinnerRecipe(page, "Icon Button Fit Dinner");
      await goToPlan(page);

      const monday = dayCard(page, "Mon");
      await pickMealForEmptySlot(page, monday, "Dinner", "Icon Button Fit Dinner");

      const reroll = monday.getByRole("button", { name: "Reroll" });
      const pin = monday.getByRole("button", { name: "Pin" });
      const remove = monday.getByRole("button", { name: "Remove from plan" });
      await expect(reroll).toBeVisible();
      await expect(pin).toBeVisible();
      await expect(remove).toBeVisible();

      for (const [label, button] of [
        ["Reroll", reroll],
        ["Pin", pin],
        ["Remove from plan", remove],
      ] as const) {
        const box = await button.boundingBox();
        expect(box, `${label} should have a bounding box`).not.toBeNull();
        expect(box!.width, `${label} width should meet --touch-target (48px)`).toBeCloseTo(48, 0);
        expect(box!.height, `${label} height should meet --touch-target (48px)`).toBeCloseTo(48, 0);
      }

      // The three buttons (plus Cook, on this still-"planned" slot) must
      // not overflow their day card sideways into the neighbour's hit area
      // — the exact click-stealing bug `.day`'s own `min-width: 0` comment
      // documents (plan.module.css).
      const dayBox = await monday.boundingBox();
      const tuesday = dayCard(page, "Tue");
      const tuesdayBox = await tuesday.boundingBox();
      expect(dayBox).not.toBeNull();
      expect(tuesdayBox).not.toBeNull();
      const removeBox = await remove.boundingBox();
      expect(removeBox).not.toBeNull();
      expect(removeBox!.x + removeBox!.width, "Remove button should not spill past Monday's own card").toBeLessThanOrEqual(
        dayBox!.x + dayBox!.width + 1,
      );
      expect(dayBox!.x + dayBox!.width, "Monday's card should not overlap Tuesday's").toBeLessThanOrEqual(
        tuesdayBox!.x + 1,
      );
    });
  }
});
