import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// UX review round 2, Finding 1 (BROKEN): owner-measured on `main` —
// `/pantry` at 1512×950 produced `document.scrollWidth` 71px past the
// viewport (1583 vs 1512). Root cause was `SegmentedControl.module.css`'s
// `.segment { flex: 1 1 auto }`: a flex item's default `min-width: auto`
// floors it at its min-content size, and with `flex-wrap` never set
// (default `nowrap`), a narrow container (Pantry/Shopping's 250px rail)
// could neither shrink the row to fit nor wrap it — so it overflowed the
// group's own box, the rail, and ultimately the page.
//
// This spec asserts the property that actually broke — no page-level
// horizontal scroll — rather than pinning a CSS value that wouldn't have
// caught the regression in the first place (`flex: 1 1 auto` LOOKED like a
// safe, deliberate rule; the bug was in what it didn't set: `flex-wrap`).
// Confirmed to FAIL on `origin/main` (07aa2ea) and pass once
// `SegmentedControl.module.css` switches to a `grid-template-columns:
// repeat(auto-fit, minmax(...))` layout (design/mock-responsive.html's
// approved `.seg.wrap` treatment).
//
// Widths: phone/tablet/desktop (`e2e/support/viewports.ts`'s `TIERS`) plus
// 768px (the exact rail breakpoint — the tablet UX reviewer's own repro
// width) and 1920px (the second width the owner measured on `main`; no
// page-level scroll there, but the segment itself rendered outside its
// card border past the viewport edge — the underlying box-overflow is the
// same bug, just not yet page-level at that width).
const WIDTHS = [390, 768, 1024, 1512, 1920] as const;

async function hasNoPageOverflow(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

for (const width of WIDTHS) {
  test(`Pantry: no page-level horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await enterReadyShell(page, "pantry");
    // Wait for the Location filter (the control that actually overflowed)
    // to be in the DOM before measuring — either the rail's copy (>=768px)
    // or the phone-tier copy (<768px) is guaranteed to be visible.
    await expect(page.getByRole("radiogroup", { name: "Location" }).first()).toBeVisible();
    expect(
      await hasNoPageOverflow(page),
      `document.documentElement.scrollWidth exceeded window.innerWidth (${width}px) on Pantry`,
    ).toBe(true);
  });

  test(`Shopping: no page-level horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await enterReadyShell(page, "shopping");
    await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();
    expect(
      await hasNoPageOverflow(page),
      `document.documentElement.scrollWidth exceeded window.innerWidth (${width}px) on Shopping`,
    ).toBe(true);
  });
}
