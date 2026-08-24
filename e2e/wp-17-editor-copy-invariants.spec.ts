import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { enterBarcode } from "./support/scan.ts";

// WP-17: an owner-measured labelling sweep on /recipes/new (a radio group
// named after one of its own options, its two options wrapping to a
// different number of lines, stepper labels repeating the field's own unit
// suffix, "Canonical unit" jargon) found four defects that a per-instance
// test would only ever catch on the ONE control it names. These tests pin
// the INVARIANT instead — walking every route that has a radiogroup today
// and asserting the generic property — so a future screen that repeats the
// same mistake fails here even though nobody wrote a test for it by name.
//
// Routes chosen because each renders at least one `SegmentedControl`
// (`role="radiogroup"`) without needing to click through a collapsed
// disclosure first (see IngredientEditor.tsx's "+ How you buy it" / scan's
// live-camera-only panels, both out of headless Chromium's reach anyway).
const ROUTES_WITH_RADIOGROUPS = [
  "recipes/new",
  "recipes/ingredients/new",
  "pantry",
  "pantry/rice",
  "settings",
  "plan",
];

// One more scenario that needs an interaction (typing a barcode) rather
// than a plain `page.goto` — the scan route's "New product" panel only
// mounts once an unrecognised barcode is entered (headless Chromium has no
// camera, so this is the only way in). Its own "Default expiry" 4-option
// control is where "1 month"/"6 months" wrapped to two lines at phone width
// while "10 days"/"1 year" stayed on one — the same defect shape as
// SPLIT_OPTIONS, on a screen the route-name list above can't reach.
async function openScanNewProductPanel(page: Page): Promise<void> {
  await enterReadyShell(page, "scan");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await enterBarcode(page, "9990001112223");
  await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();
}

interface RadioGroupSnapshot {
  readonly groupName: string;
  readonly options: readonly { readonly name: string; readonly height: number }[];
}

/**
 * Walks every `[role="radiogroup"]` on the current page and reads back its
 * accessible name plus each `[role="radio"]` option's accessible name and
 * rendered text height (for the line-wrap check). Native accessible-name
 * computation (label wraps the input — see SegmentedControl.tsx's `Segment`)
 * is trusted here via `aria-label`/wrapping `<label>` text content, mirroring
 * how a screen reader would read it.
 */
async function snapshotRadioGroups(page: import("@playwright/test").Page): Promise<readonly RadioGroupSnapshot[]> {
  return page.evaluate(() => {
    function accessibleNameOf(el: Element): string {
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel.trim();
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        return labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
      }
      return (el.textContent ?? "").trim();
    }

    const groups = Array.from(document.querySelectorAll('[role="radiogroup"]'));
    return groups.map((group) => {
      // Real `<input type="radio">` elements carry the "radio" role
      // IMPLICITLY (react-aria's `useRadio` relies on native semantics
      // rather than an explicit `role` attribute) — an attribute selector
      // `[role="radio"]` matches nothing here even though
      // `getByRole("radio", ...)` resolves it fine via the accessibility
      // tree, so query the real input type instead.
      const radios = Array.from(group.querySelectorAll('input[type="radio"]'));
      const options = radios.map((radio) => {
        // The radio's accessible name comes from the wrapping <label> (its
        // text content, icons excluded via aria-hidden) — see
        // SegmentedControl.tsx's `Segment`.
        const label = radio.closest("label");
        const name = (label?.textContent ?? accessibleNameOf(radio)).trim();
        // The label text itself sits in its own trailing <span> — measuring
        // ITS box (not the flex-centred, row-stretched <label>) is what
        // actually reveals a wrap to a second line.
        const span = label?.querySelector("span:last-child");
        const height = (span ?? label ?? radio).getBoundingClientRect().height;
        return { name, height };
      });
      return { groupName: accessibleNameOf(group), options };
    });
  });
}

test.describe("radio groups / segmented controls: no group named after its own option", () => {
  for (const route of ROUTES_WITH_RADIOGROUPS) {
    test(`route "/${route}"`, async ({ page }) => {
      await enterReadyShell(page, route);
      await expect(page.getByRole("main")).toBeVisible();
      // Past the React.lazy route chunk's Suspense fallback (see
      // wp-15-a11y.spec.ts's own comment on this) — the fallback has no
      // heading, every real route renders one unconditionally.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const groups = await snapshotRadioGroups(page);

      for (const { groupName, options } of groups) {
        for (const option of options) {
          expect(
            groupName.toLowerCase(),
            `radiogroup "${groupName}" must not share its accessible name with its own option "${option.name}" — a screen reader announces "${groupName}, group" then "${option.name}, radio" indistinguishably`,
          ).not.toBe(option.name.toLowerCase());
        }
      }
    });
  }

  test('scan\'s "New product" panel (phone width)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScanNewProductPanel(page);
    const groups = await snapshotRadioGroups(page);
    for (const { groupName, options } of groups) {
      for (const option of options) {
        expect(groupName.toLowerCase()).not.toBe(option.name.toLowerCase());
      }
    }
  });
});

test.describe("segmented controls: sibling options never render with a different number of lines", () => {
  for (const route of ROUTES_WITH_RADIOGROUPS) {
    test(`route "/${route}"`, async ({ page }) => {
      await enterReadyShell(page, route);
      await expect(page.getByRole("main")).toBeVisible();
      // Past the React.lazy route chunk's Suspense fallback (see
      // wp-15-a11y.spec.ts's own comment on this) — the fallback has no
      // heading, every real route renders one unconditionally.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const groups = await snapshotRadioGroups(page);

      for (const { groupName, options } of groups) {
        if (options.length < 2) continue;
        const heights = options.map((o) => o.height).filter((h) => h > 0);
        if (heights.length < 2) continue;
        const min = Math.min(...heights);
        const max = Math.max(...heights);
        // A same-line pair differs only by sub-pixel rounding; a genuine
        // one-line-vs-two-line mismatch roughly doubles the taller box.
        // 1.5x sits strictly between those two cases.
        expect(
          max / min,
          `radiogroup "${groupName}" renders its options at mismatched heights (${JSON.stringify(options)}) — one option is wrapping to a second line while a sibling stays on one`,
        ).toBeLessThan(1.5);
      }
    });
  }

  test('scan\'s "New product" panel — Default expiry preset (phone width)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScanNewProductPanel(page);
    const groups = await snapshotRadioGroups(page);
    for (const { groupName, options } of groups) {
      if (options.length < 2) continue;
      const heights = options.map((o) => o.height).filter((h) => h > 0);
      if (heights.length < 2) continue;
      const min = Math.min(...heights);
      const max = Math.max(...heights);
      expect(
        max / min,
        `radiogroup "${groupName}" renders its options at mismatched heights (${JSON.stringify(options)})`,
      ).toBeLessThan(1.5);
    }
  });
});

for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1512, height: 950 },
]) {
  test(`recipe editor's "Splitting" control: neither option wraps at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterReadyShell(page, "recipes/new");
    await expect(page.getByRole("main")).toBeVisible();
    // Past the React.lazy route chunk's Suspense fallback (see
    // wp-15-a11y.spec.ts's own comment on this) — the fallback has no
    // heading, every real route renders one unconditionally.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Splitting" })).toBeVisible();
    const groups = await snapshotRadioGroups(page);
    const splitting = groups.find((g) => g.groupName === "Splitting");
    expect(splitting, JSON.stringify(groups)).toBeDefined();
    const splits = splitting!.options.find((o) => o.name === "Splits");
    const cant = splitting!.options.find((o) => o.name === "Whole");
    expect(splits, JSON.stringify(splitting)).toBeDefined();
    expect(cant, JSON.stringify(splitting)).toBeDefined();
    expect(splits!.height / cant!.height).toBeLessThan(1.5);
    expect(cant!.height / splits!.height).toBeLessThan(1.5);
  });
}
