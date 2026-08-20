import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// Owner-reported regression, 2026-08-20 (twice): a leftover `#root {
// max-width: 1126px }` from the WP-01 Vite scaffold capped the ENTIRE shell
// — header and nav included — into a narrow centred column, so on a wide
// screen the header read as a floating band with empty space on either
// side. The fix removed #root's max-width and gave AppShell's own
// `.headerInner`/`.navInner` the measure instead (src/index.css,
// src/ui/AppShell.module.css). This spec pins the visible, measurable
// symptom — a screenshot caught it once; nothing here should let it
// regress silently again.
//
// Also covers the "one bar, not two" amendment: the primary nav is nested
// inside <header> (not a second row underneath it) at this width.
test.describe("desktop shell layout (UI_DESIGN.md §13, owner-reported 2026-08-20)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the header bar is full-bleed — spans the viewport width", async ({ page }) => {
    await enterReadyShell(page);
    const viewportWidth = page.viewportSize()?.width;
    expect(viewportWidth).toBeTruthy();

    const header = page.locator("header");
    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    // Full-bleed: starts at the left edge and reaches (within a hair of)
    // the right edge — NOT capped to 1126px (or any other narrower value)
    // inside a 1440px viewport.
    expect(box!.x).toBeLessThan(1);
    expect(box!.width).toBeGreaterThanOrEqual(viewportWidth! - 1);
  });

  test("the header is one merged bar — nav sits inside it, not in a separate row underneath", async ({ page }) => {
    await enterReadyShell(page);
    const header = page.locator("header");
    const nav = page.getByRole("navigation", { name: "Primary" });

    const headerBox = await header.boundingBox();
    const navBox = await nav.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(navBox).not.toBeNull();

    // One ~56-64px bar, not "header row (~56px) + nav row (~56px) stacked".
    expect(headerBox!.height).toBeLessThan(80);
    // The nav's box is vertically contained within the header's box.
    expect(navBox!.y).toBeGreaterThanOrEqual(headerBox!.y - 1);
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height + 1);
  });

  test("the header's own contents keep the same measure as the page content — not stretched to the full-bleed edges", async ({
    page,
  }) => {
    await enterReadyShell(page);
    const nav = page.getByRole("navigation", { name: "Primary" });
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    // The nav's own box (inline within the measured header row) is nowhere
    // near the 1440px viewport — it's sized to its content within the
    // 840px measure, not stretched.
    expect(navBox!.width).toBeLessThan(840);
  });

  test("main content keeps its own ~840px reading measure, independent of the full-bleed bar", async ({ page }) => {
    await enterReadyShell(page);
    // The direct child of <main> is .mainMeasure (AppShell.module.css) —
    // capped and centred at >=768px, unaffected by the header/#root fix.
    const measure = page.locator("main > div").first();
    const box = await measure.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(841);
  });
});
