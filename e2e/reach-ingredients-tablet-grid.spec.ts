import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { goToIngredients } from "./support/ingredients.ts";

// Tablet UI/UX review, finding 3: the ingredients catalog was capped at the
// 840px reading measure at every tier, wasting ~184px of width at 1024px
// (and ~540px at the owner's 1378px iPad) next to a plain single-column
// list. design/mock-responsive.html's Ingredients tier note is the approved
// fix: widen the container ONLY within the 768-1439px tablet band
// (AppShell.tsx's `TABLET_WIDE_ROUTES`/`.mainTabletWide`) and reflow the
// list into a multi-column card grid there (`ListSection`'s
// `layout="grid"`/`ListRow`'s `variant="card"`). Phone and desktop both
// keep today's single-column list untouched — desktop's exact 840px cap is
// already pinned by e2e/wp-vc-visual-conformance.spec.ts's "the ingredients
// catalog keeps the narrow reading measure" test, left as-is here; this
// spec adds the tablet-only mechanism plus a same-shape regression guard at
// the other two tiers.
//
// The catalog is reached by clicking through the real UI (Recipes -> the
// Ingredients tab) on a freshly-seeded workbook, which already carries
// ~100 catalog ingredients — never `page.goto` to the route directly, and
// no fixture ingredients need adding for a layout-only check.

async function rowsContainerMechanism(page: import("@playwright/test").Page): Promise<{
  readonly display: string;
  readonly columnCount: number;
}> {
  // `.rowsGrid`'s compiled class name always contains the substring "rows"
  // too (it's `.rows`'s sibling modifier class, added alongside it — see
  // ListSection.tsx), so this one substring selector finds the row
  // container in both the plain-list and grid states.
  const rows = page.locator('[class*="rows"]').first();
  return rows.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { display: cs.display, columnCount: cs.gridTemplateColumns.split(" ").length };
  });
}

test.describe("Ingredients catalog — tablet card grid (tablet UI/UX review, finding 3)", () => {
  test("tablet (1024px): the container widens past the 840px measure and the list reflows into a multi-column grid", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 1366 });
    await enterReadyShell(page, "recipes");
    await goToIngredients(page);

    const container = page.locator("main > div").first();
    const containerBox = await container.boundingBox();
    expect(containerBox).not.toBeNull();
    expect(
      containerBox!.width,
      "container should widen past the 840px reading measure at tablet width",
    ).toBeGreaterThan(900);

    const mechanism = await rowsContainerMechanism(page);
    expect(mechanism.display, "the row list should become a CSS grid at tablet width").toBe("grid");
    expect(mechanism.columnCount, "should reflow into more than one column").toBeGreaterThan(1);

    // Behavioural confirmation, not just computed style: at least two
    // ingredient cards actually sit side by side (share a row), not one
    // per line — the visible symptom a screenshot would catch.
    const rowsLocator = page.locator('[class*="rowsGrid"]');
    const cardTops = await rowsLocator.locator("> *").evaluateAll((els) =>
      els.slice(0, 6).map((el) => Math.round(el.getBoundingClientRect().y)),
    );
    expect(new Set(cardTops).size, "at least two cards should share a row").toBeLessThan(cardTops.length);
  });

  test("phone (390px) keeps the single-column list, unaffected by the tablet grid", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterReadyShell(page, "recipes");
    await goToIngredients(page);

    const mechanism = await rowsContainerMechanism(page);
    expect(mechanism.display).not.toBe("grid");
  });

  test("desktop (1512px) keeps the single-column list and the narrow reading measure, unaffected by the tablet grid", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1512, height: 950 });
    await enterReadyShell(page, "recipes");
    await goToIngredients(page);

    const container = page.locator("main > div").first();
    const containerBox = await container.boundingBox();
    expect(containerBox).not.toBeNull();
    expect(containerBox!.width, "desktop keeps the 840px reading measure").toBeLessThanOrEqual(841);

    const mechanism = await rowsContainerMechanism(page);
    expect(mechanism.display).not.toBe("grid");
  });
});
