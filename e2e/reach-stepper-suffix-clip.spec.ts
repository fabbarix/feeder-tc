import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { expectStepperDoesNotClipUnit } from "./support/stepper.ts";
import { seedShoppingNeed } from "./support/shopping.ts";
import { TIERS } from "./support/viewports.ts";

// Pinned defect: `QuantityInput`'s unit suffix ("servings", "min", …) was
// clipped by its own "+" stepper button — "4 servings" rendered with
// "servings" cut off, "15 min" as "15 mir". Root cause:
// `QuantityInput.module.css`'s `.stepper` used `:first-child`/`:last-child`
// to give the decrease/increase buttons opposite flush-margins, but
// `Tooltip` (Tooltip.tsx) wraps EVERY stepper button in its own
// `<span class="wrap">{button}<span class="bubble"/></span>` — so a stepper
// button is always the first child of its own parent and never the last.
// `:first-child` matched BOTH buttons; `:last-child` matched NEITHER. The
// increase button silently got the decrease button's "flush left" margin
// instead of its own "flush right, gap on the left" margin, pulling it 16px
// further left than intended and 4px into the suffix text — independent of
// how long the unit word is, which is why both "min" and "servings" clipped
// the same fixed amount.
//
// This asserts the INVARIANT (TESTING.md: pin the property, not the
// instance) across both stepper implementations this app has
// (`QuantityInput.module.css`'s `.stepper` and `Stepper.tsx`/`forms.qty`),
// at phone and desktop widths, with both a short unit ("min") and a long
// one ("servings") — a future consumer that reuses either component with an
// even longer unit is covered by the same assertion, not a new one.
//
// Confirmed to FAIL on `origin/main` (ac6cfb7) before the `data-edge` fix
// (see QuantityInput.tsx/.module.css) — the "servings"/plus-button pair
// overlapped by ~4px at every width tested.

const PHONE = TIERS.find((t) => t.name === "phone")!;
const DESKTOP = TIERS.find((t) => t.name === "desktop")!;

test.describe("QuantityInput steppers never clip their unit suffix", () => {
  for (const tier of [PHONE, DESKTOP]) {
    test(`recipe editor: servings, prep, cook and step-duration fields at ${tier.name}`, async ({ page }) => {
      await page.setViewportSize({ width: tier.width, height: tier.height });
      await enterReadyShell(page, "recipes/new");

      // Four independent QuantityInput+showSteppers fields on this one
      // screen: Servings ("servings", the long unit), Prep time / Cook time
      // / step Duration (all "min", the short one).
      const suffixes = page.locator('[id$="-unit"]');
      await expect(suffixes.first()).toBeVisible();
      const count = await suffixes.count();
      expect(count, "expected the four QuantityInput unit suffixes to be present").toBeGreaterThanOrEqual(4);

      for (let i = 0; i < count; i += 1) {
        const suffix = suffixes.nth(i);
        const control = suffix.locator("xpath=..");
        await expectStepperDoesNotClipUnit(suffix, control.locator("button"));
      }
    });

    test(`settings: household size, repeat window and reuse gap at ${tier.name}`, async ({ page }) => {
      await page.setViewportSize({ width: tier.width, height: tier.height });
      await enterReadyShell(page, "settings");

      // `Stepper.tsx` renders "<value> <unit>" inside one `.qtyValue` span
      // (forms.module.css) — the unit itself is the nested `.qtyUnit` span,
      // a sibling of the +/- buttons within `.qty`, not `.control`'s DOM
      // shape. "people"/"weeks"/"meals" are all short units here — the long
      // "servings" case is covered by the recipe editor test above, so this
      // exercises the SECOND stepper implementation rather than a second
      // unit length.
      const units = page.locator('[class*="qtyUnit"]');
      await expect(units.first()).toBeVisible();
      const count = await units.count();
      expect(count, "expected the three Settings steppers' unit spans to be present").toBeGreaterThanOrEqual(3);

      for (let i = 0; i < count; i += 1) {
        const unit = units.nth(i);
        // .qty > [+/- buttons, .qtyValue]; unit's ancestor::div[contains(@class,"qty")] is the shared container.
        const qty = unit.locator('xpath=ancestor::*[contains(@class, "qty")][not(contains(@class, "qtyValue"))][1]');
        await expectStepperDoesNotClipUnit(unit, qty.locator("button"));
      }
    });

    test(`shopping: adjust-quantity dialog at ${tier.name}`, async ({ page }) => {
      await page.setViewportSize({ width: tier.width, height: tier.height });
      // Seed BEFORE navigating to Shopping (not a reload afterwards) — the
      // access token lives only in memory for the tab's life (shell.ts's
      // own doc comment), so a real navigation drops it and re-gates the
      // app; client-side navigation via the nav link is unaffected and
      // lets Shopping's data hook boot fresh against the seeded workbook,
      // same pattern as e2e/wp-23-shopping-trip.spec.ts.
      await enterReadyShell(page);
      await seedShoppingNeed(page, { recipeName: "Stepper Clip Test Dinner", ingredientId: "rice", amount: 500, unit: "g" });
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Shopping", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();

      const row = page.getByRole("checkbox", { name: /rice/i }).locator("xpath=ancestor::label[1]");
      await row.getByRole("button").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: /^Adjust:/ })).toBeVisible();

      // Same `forms.qty` markup as Settings' Stepper.tsx, but built directly
      // in ShoppingRow.tsx rather than through the shared component — the
      // whole point of pinning the property rather than one component.
      // Unlike Settings' `Stepper.tsx`, this one has no separate `.qtyUnit`
      // span — `formatBuyPrimary` returns "500 g" as one plain-text node —
      // so `.qtyValue` itself is the unit-bearing element to protect.
      const unit = dialog.locator('[class*="qtyValue"]');
      await expect(unit).toBeVisible();
      const qty = dialog.locator('[class*="qty"]:not([class*="qtyValue"])').first();
      await expectStepperDoesNotClipUnit(unit, qty.locator("button"));
    });
  }
});
