import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { goToShopping, seedShoppingNeed } from "./support/shopping.ts";

// `journey-household-week.spec.ts` covers the full cross-feature session; this
// file targets specifically the CSS-breakpoint-gated "wide rail" controls
// that journey can only sanity-check inline (it doesn't have room for the
// full reachability-at-every-tier matrix without tripling its own length).
// Every `display:none`/`@media(min-width:768px)` rule under src/routes/ and
// src/ui/ was grepped and read while researching this suite — the two
// findings below (Pantry's filters rail, and Shopping's Custom-range chip)
// are the only ones with real behavioural consequences; the rest (Plan's
// `.week`/`.dayList` DOM-duplication, AppShell's nav-icon fade, Shopping's
// short/long provenance text swap, the price-history table/list DOM swap)
// are cosmetic or already DOM-duplicated for accessibility and covered by
// the existing role-based specs regardless of viewport.

test.describe("Pantry's filters (Location + \"Show\"/Leftovers) are reachable at every tier", () => {
  // WAS a known gap, same shape as the barcode-scanner bug this suite exists
  // to catch: pantry.module.css's `.rail` is `display:none` below 768px and
  // nothing stood in for it, so a household member on a phone could not
  // filter by storage location, could not see "Expiring"/"Opened" only, and
  // could not reach the "Leftovers" view of the pantry AT ALL.
  //
  // FIXED — this branch adds the phone-tier controls the approved mock
  // specifies (a Stock/Leftovers segmented tab plus a filter row) on the
  // exact inverse media query, the same mirror-image invariant `af73a08`
  // used for the scan FAB and its page action.
  //
  // The `test.fail()` marker was removed once Playwright reported "Expected
  // to fail, but passed" against the fix — the same handover this project
  // used for the outbox duplicate-append bug. Kept as a permanent
  // regression guard: it is what proves the phone tier still has a route to
  // Leftovers at all.
  test(
    "the Location/Show filters (and therefore Leftovers) are reachable at phone width (390px)",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await enterReadyShell(page, "pantry");
      await expect(page.getByRole("group", { name: "Show" }), "no reachable Show/Leftovers filter at 390px").toBeVisible();
    },
  );

  for (const tier of [
    { name: "tablet", width: 1024, height: 1366 },
    { name: "desktop", width: 1512, height: 950 },
  ] as const) {
    test(`the Location/Show filters ARE reachable at ${tier.name} (${tier.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: tier.width, height: tier.height });
      await enterReadyShell(page, "pantry");
      const show = page.getByRole("group", { name: "Show" });
      await expect(show).toBeVisible();
      await expect(show.getByRole("button", { name: "Leftovers" })).toBeEnabled();
      await expect(page.getByRole("radiogroup", { name: "Location" }).first()).toBeVisible();
    });
  }
});

test.describe('Shopping\'s "Custom range…" chip — a deliberate tablet/desktop-only escape hatch, not a bug', () => {
  // RangeChips.module.css's `.customChip` is `display:none` below 768px BY
  // DESIGN (UI_DESIGN.md §1 "mobile-first is literal" — the mock's phone
  // filters row never shows it, only the four fixed presets). Unlike the
  // Pantry gap above, phone loses nothing essential here: all four presets
  // remain, and every row's own "Why?" disclosure (unconditional at every
  // tier) already explains the list without the rail. Locking in the
  // EXPECTED difference, not asserting a defect.
  test("phone (390px): only the four fixed presets — no Custom range escape hatch", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterReadyShell(page, "shopping");
    const range = page.getByRole("group", { name: "Shopping range" });
    await expect(range.getByRole("button", { name: "This week" })).toBeVisible();
    await expect(range.getByRole("button", { name: "Custom range…" })).toHaveCount(0);
  });

  for (const tier of [
    { name: "tablet", width: 1024, height: 1366 },
    { name: "desktop", width: 1512, height: 950 },
  ] as const) {
    test(`${tier.name} (${tier.width}px): Custom range… is reachable and opens the from/to calendars`, async ({ page }) => {
      await page.setViewportSize({ width: tier.width, height: tier.height });
      await enterReadyShell(page, "shopping");
      const custom = page.getByRole("group", { name: "Shopping range" }).getByRole("button", { name: "Custom range…" });
      await expect(custom).toBeVisible();
      await custom.click();
      await expect(page.getByText("From", { exact: true })).toBeVisible();
      await expect(page.getByText("To", { exact: true })).toBeVisible();
    });
  }
});

test.describe("Shopping's \"why is this on my list\" rail — ships from 768px up (tablet AND desktop), not desktop-only", () => {
  // Worth pinning explicitly: this rail is commonly described (including in
  // this suite's own dispatch brief) as a "desktop-only" enhancement, but
  // shopping.module.css's `.rail` uses the SAME 768px query as everything
  // else in this codebase — it ships at the TABLET tier too. The per-row
  // "Why?" disclosure (ShoppingRow.tsx's `.why`) is unconditional at every
  // tier including phone, so nothing is actually unreachable here; this is
  // purely about getting the tier boundary right rather than repeating a
  // slightly-wrong shorthand.
  test("phone (390px): no rail, but the per-row Why? disclosure is still there", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Seed BEFORE the first navigation to Shopping — useShoppingList reads
    // its data once at mount, so landing on Shopping via enterReadyShell and
    // only THEN seeding would leave that first mount looking at an empty
    // workbook, and clicking "Shopping" again (already the active route)
    // does not force react-router to remount/refetch.
    await enterReadyShell(page);
    await seedShoppingNeed(page, { recipeName: "Reach-rail dinner", ingredientId: "rice", amount: 400, unit: "g" });
    await goToShopping(page);
    await expect(page.getByRole("checkbox", { name: /rice/i })).toBeVisible();
    // `.rail` is one DOM, CSS-toggled (shopping.module.css) — `display:none`
    // still leaves the text in the DOM, so this must check computed
    // visibility, not DOM presence (`toHaveCount(0)` would wrongly fail).
    await expect(page.getByText("items still to buy")).not.toBeVisible();
  });

  for (const tier of [
    { name: "tablet", width: 1024, height: 1366 },
    { name: "desktop", width: 1512, height: 950 },
  ] as const) {
    test(`${tier.name} (${tier.width}px): the rail is reachable`, async ({ page }) => {
      await page.setViewportSize({ width: tier.width, height: tier.height });
      await enterReadyShell(page); // seed before the first navigation to Shopping — see the phone case's comment above
      await seedShoppingNeed(page, { recipeName: "Reach-rail dinner", ingredientId: "rice", amount: 400, unit: "g" });
      await goToShopping(page);
      await expect(page.getByRole("checkbox", { name: /rice/i })).toBeVisible();
      await expect(page.getByText("items still to buy")).toBeVisible();
    });
  }
});
