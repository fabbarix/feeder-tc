import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

/**
 * `@e2e` — the Pantry location filter, the Expiring/Opened filter, and the
 * Leftovers view must all be REACHABLE at every width.
 *
 * Owner-reported: `pantry.module.css`'s `.rail` is `display: none` below
 * 768px and nothing ever replaced it, so on a phone there was no way to
 * filter by storage location, filter by Expiring/Opened, or reach Leftovers
 * at all — Leftovers being a headline feature made this the most severe of
 * its kind found so far. Same failure shape as `af73a08` (the scan FAB
 * hidden from 768px up with nothing replacing it) — this is that bug in
 * mirror image, missing at NARROW widths instead of wide ones.
 *
 * design/mock-responsive.html's approved #pantry phone tier answers this: a
 * "Stock"/"Leftovers" segmented tab above a horizontal filter row, standing
 * in for the rail exactly below 768px. Tablet and desktop keep the existing
 * rail (its own "Location" radiogroup + "Show" toggle chips, "Leftovers"
 * among them) unchanged — this spec asserts reachability there too, so a
 * future edit to either media query breaking the mirror-image invariant is
 * caught regardless of which side regresses.
 *
 * Every assertion is about REACHABILITY (a visible, enabled control with an
 * accessible name that actually does what it says — proven by watching the
 * list react, not just watching the control render) rather than which
 * element renders it, matching e2e/m6-scan-reachable.spec.ts's approach: a
 * future redesign that moves the affordance still passes, removing it fails.
 */
const TIERS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "desktop", width: 1512, height: 950 },
] as const;

async function openIngredientSheet(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: /ingredient/i }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

/** Adds one lot of `name` via the "Add to pantry" form, at its catalog default location — same shape as wp-21-pantry-management.spec.ts's setup. */
async function addLot(page: Page, name: string, amount: string): Promise<void> {
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await openIngredientSheet(page, name);
  await page.getByRole("textbox", { name: /amount/i }).fill(amount);
  await page.getByRole("button", { name: "Add to pantry" }).click();
}

const NOTHING_MATCHES = "Nothing matches these filters";

for (const tier of TIERS) {
  test(`Pantry filters are reachable at ${tier.name} (${tier.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: tier.width, height: tier.height });
    await enterReadyShell(page, "pantry");

    // Rice defaults to "pantry", Milk defaults to "fridge" (seed-catalog.ts)
    // — two lots in two different locations, so the Location filter has
    // something real to prove.
    await addLot(page, "Rice", "500");
    await addLot(page, "Milk", "500");
    await expect(page.getByRole("link", { name: /Rice/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Milk/ })).toBeVisible();

    // --- Location filter ---------------------------------------------------
    const locationGroup = page.getByRole("radiogroup", { name: "Location" });
    await expect(locationGroup, `no reachable Location filter at ${tier.width}px`).toBeVisible();
    const fridgeOption = locationGroup.getByRole("radio", { name: "Fridge" });
    await expect(fridgeOption).toBeEnabled();
    await fridgeOption.click();
    await expect(page.getByRole("link", { name: /Milk/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Rice/ })).toHaveCount(0);
    await locationGroup.getByRole("radio", { name: "All" }).click();
    await expect(page.getByRole("link", { name: /Rice/ })).toBeVisible();

    // --- Expiring/Opened filter ---------------------------------------------
    // Neither lot has been opened, so switching "Opened" on empties the list
    // — proof the control is wired to real filtering, not just rendered.
    const showGroup = page.getByRole("group", { name: "Show" });
    await expect(showGroup, `no reachable Expiring/Opened filter at ${tier.width}px`).toBeVisible();
    const openedOption = showGroup.getByRole("button", { name: "Opened" });
    await expect(openedOption).toBeEnabled();
    await openedOption.click();
    await expect(page.getByText(NOTHING_MATCHES)).toBeVisible();
    await openedOption.click();
    await expect(page.getByText(NOTHING_MATCHES)).toHaveCount(0);

    // --- Leftovers -----------------------------------------------------------
    // Phone reaches it through the new "Pantry section" Stock/Leftovers tab
    // (design/mock-responsive.html's phone tier); tablet/desktop keep the
    // existing "Leftovers" chip in the "Show" group. Neither Rice nor Milk is
    // a leftover (unit "portion" is leftover-lot-only — src/data/seed-catalog.ts),
    // so reaching the Leftovers view empties the list exactly like "Opened"
    // above — the same proof of real wiring, without needing a cooked leftover.
    if (tier.name === "phone") {
      const section = page.getByRole("radiogroup", { name: "Pantry section" });
      await expect(section, `no reachable Leftovers tab at ${tier.width}px`).toBeVisible();
      const leftoversTab = section.getByRole("radio", { name: "Leftovers" });
      await expect(leftoversTab).toBeEnabled();
      await leftoversTab.click();
    } else {
      // The phone-only tab must NOT also exist at tablet/desktop — exactly
      // one Leftovers control reachable at a time (see the invariant test
      // below).
      await expect(page.getByRole("radiogroup", { name: "Pantry section" })).toHaveCount(0);
      const leftoversChip = showGroup.getByRole("button", { name: "Leftovers" });
      await expect(leftoversChip, `no reachable Leftovers control at ${tier.width}px`).toBeVisible();
      await expect(leftoversChip).toBeEnabled();
      await leftoversChip.click();
    }
    await expect(page.getByText(NOTHING_MATCHES)).toBeVisible();
  });
}

for (const tier of TIERS) {
  test(`exactly one filter surface is visible at a time at ${tier.name} (${tier.width}px) — never two, never none`, async ({
    page,
  }) => {
    // `.rail` and `.phoneFilters` (pantry.module.css) are exact mirror-image
    // media queries. If either breakpoint is edited without the other, both
    // could show at once or neither could — pin the invariant itself, same as
    // m6-scan-reachable.spec.ts does for the scan FAB/page-action pair.
    //
    // One tier per test (a fresh page/context each), deliberately not a
    // single test looping `enterReadyShell` 3x on one page: a second
    // `page.goto` re-runs the sign-in flow against the SAME workbook
    // registry entry (localStorage-backed, survives reload —
    // support/shell.ts) while msw's in-memory fake Sheets backend does not,
    // so the second navigation lands on a registered-but-unbootstrapped
    // workbook and the route legitimately errors ("Meta sheet has no data
    // row"). That's a fact about re-navigating in one test, not a Pantry bug.
    await page.setViewportSize({ width: tier.width, height: tier.height });
    await enterReadyShell(page, "pantry");
    // `enterReadyShell` only waits for the shell's own nav, not for this
    // route's data load — the filter surfaces are gated behind
    // `!pantry.loading`, so count() (unlike `expect(...).toBeVisible()`,
    // used elsewhere in this file) doesn't retry and can sample mid-skeleton.
    // The empty-pantry EmptyState's "Add to pantry" button only appears once
    // loaded, so wait for it first.
    await expect(page.getByRole("button", { name: "Add to pantry" })).toBeVisible();

    const locationCount = await page.getByRole("radiogroup", { name: "Location" }).count();
    expect(locationCount, `${tier.name} (${tier.width}px) should render exactly one Location filter`).toBe(1);

    const showCount = await page.getByRole("group", { name: "Show" }).count();
    expect(showCount, `${tier.name} (${tier.width}px) should render exactly one Show filter`).toBe(1);

    const sectionCount = await page.getByRole("radiogroup", { name: "Pantry section" }).count();
    if (tier.name === "phone") {
      expect(sectionCount, "phone should render the Stock/Leftovers tab").toBe(1);
    } else {
      expect(sectionCount, `${tier.name} (${tier.width}px) should not render the phone-only Stock/Leftovers tab`).toBe(
        0,
      );
    }
  });
}
