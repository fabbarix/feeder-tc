import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { goToIngredients } from "./support/ingredients.ts";

// Regression guard for the defect a design reviewer measured and the owner
// confirmed at source: `ListSection.module.css`'s reflowing card grid
// (`layout="grid"`, Ingredients' only consumer) used to be gated to
// `(min-width: 768px) and (max-width: 1439.98px)` — a tablet-only media
// query nobody extended upward, the same pattern as an earlier tablet work
// package. Above 1439.98px it fell all the way back to a single column, so
// the WIDEST viewport rendered FEWER columns than the middle (tablet) one:
// 4 columns at 1024px, 1 column at 1512px. Fixed by dropping the upper
// bound in ListSection.module.css/ListRow.module.css so the grid (and its
// matching `ListRow` card box treatment) stays live at every width from
// 768px up — `auto-fill`/`minmax(230px, 1fr)` already keeps reflowing with
// the container, it just needed to not be capped.
//
// This asserts the actual property that broke — rendered column count must
// never DECREASE as the viewport widens — measured across the six tiers the
// task brief calls out, including both sides of the old 1440px cutoff
// (1440 and 1512 explicitly, since that boundary is exactly where the bug
// used to bite). It measures real rendered geometry (how many distinct
// x-positions the first several cards land on), never a class name or a
// computed CSS string, so it would catch a regression that kept
// `display: grid` but zeroed out `grid-template-columns` too.
//
// One sign-in/bootstrap for the whole test, then plain viewport resizes
// (`page.setViewportSize`, no navigation) between measurements — this is a
// client-side SPA, so a resize alone re-flows layout without touching
// React/router state. Re-running `enterReadyShell`'s own `page.goto` per
// tier was tried and rejected: that's a real browser navigation, and msw's
// mocked backend state is only as durable as the page it's attached to, so
// a second `goto` in the same test lands on the already-created workbook
// (the registry survives, per `enterReadyShell`'s doc comment) but with a
// freshly reset, unseeded mock backend behind it — "No ingredients yet"
// instead of the ~100-row catalog, which would make this test measure
// nothing.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 1366 },
  { width: 1440, height: 900 },
  { width: 1512, height: 950 },
  { width: 1920, height: 1080 },
];

async function renderedColumnCount(page: import("@playwright/test").Page): Promise<number> {
  // Count distinct left-edge x-positions among the first several cards —
  // this is the number of columns actually laid out on screen, regardless
  // of whether the container is a CSS grid, flex-wrap, or anything else.
  const rows = page.locator('[class*="rows"]').first();
  const children = rows.locator("> *");
  await expect(children.first()).toBeAttached();
  const xPositions = await children.evaluateAll((els) =>
    els.slice(0, 12).map((el) => Math.round(el.getBoundingClientRect().x)),
  );
  return new Set(xPositions).size;
}

test.describe("Ingredients catalog card grid — column count must not decrease as the viewport widens", () => {
  test("rendered column count is monotonically non-decreasing across 390/768/1024/1440/1512/1920", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0]!);
    await enterReadyShell(page, "recipes");
    await goToIngredients(page);
    // The catalog fetches its ~100 rows from the mocked Sheets backend after
    // the tab switch, rendering three `Skeleton`s until it resolves
    // (Ingredients.tsx) — wait for the real "N of M" heading once, up front,
    // before measuring at any viewport.
    await expect(page.getByRole("heading", { name: /^\d+ of \d+$/ })).toBeVisible({ timeout: 15_000 });

    const counts: number[] = [];
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      const count = await renderedColumnCount(page);
      counts.push(count);
    }

    const summary = VIEWPORTS.map((v, j) => `${v.width}px=${counts[j]}`).join(", ");
    for (let i = 1; i < counts.length; i += 1) {
      const current = counts[i] ?? 0;
      const previous = counts[i - 1] ?? 0;
      expect(
        current,
        `column count at ${VIEWPORTS[i]!.width}px (${current}) must not be fewer than at ${VIEWPORTS[i - 1]!.width}px (${previous}): ${summary}`,
      ).toBeGreaterThanOrEqual(previous);
    }

    // Sanity floor: the phone tier is genuinely one column, and at least one
    // wider tier reflows into more than one — otherwise the monotonic check
    // above would trivially pass on an all-1s regression.
    expect(counts[0]).toBe(1);
    expect(Math.max(...counts)).toBeGreaterThan(1);
  });
});
