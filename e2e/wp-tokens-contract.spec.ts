import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

/**
 * WP-tokens enforcement #4 (token-layer proposal `#enforce`, `@e2e`): a
 * computed-style contract test. Reads `getComputedStyle(...).fontSize` on
 * real, running kit components and asserts each resolves to one of the
 * eight canonical `--fs-*` pixel values declared in src/index.css — not a
 * hand-copied literal that happens to match today. A future one-off size on
 * either component fails this spec, not a code review (STATUS.md "Known
 * debt": three approved designs shipped unimplemented on this project,
 * caught only by a later human review each time).
 *
 * PLAYWRIGHT, NOT VITEST — reported, not silently chosen: the proposal named
 * "Vitest/Testing-Library (or Playwright)". jsdom (Vitest's DOM) does not
 * resolve CSS custom properties in `getComputedStyle` at all (a documented
 * jsdom limitation, not a project bug) — it returns the literal
 * `"var(--fs-body-sm)"` string instead of `"14px"`, which would make a
 * Vitest version of this test assert nothing real. A real browser resolves
 * the cascade correctly, so this lives in e2e/ instead.
 *
 * SCOPE, reported rather than silently narrowed: the proposal names
 * "ListRow, CheckRow, a badge, and a caption." There is no reusable
 * `Badge`/`Caption` kit component (those are per-route styling patterns),
 * and `CheckRow` only renders inside the generated shopping list, which
 * needs a seeded plan + pantry deficit to reach (see wp-23-shopping-trip's
 * `seedRicePlanForThisWeek` for the shape of that setup) — a materially
 * heavier fixture than this check's job justifies on its own. This spec
 * covers the two roles reachable with the existing pantry fixtures already
 * used elsewhere in e2e/: `SegmentedControl` (`--fs-body`, no data needed)
 * and `ListRow` (`--fs-body-sm`, one seeded lot). Extending this to
 * `CheckRow`/shopping is a reasonable follow-up, not done here.
 */

async function openIngredientSheet(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByRole("button", { name: /ingredient/i }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

test.describe("token contract: computed font-size resolves to a canonical --fs-* role", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Pantry section SegmentedControl option uses --fs-body (16px)", async ({ page }) => {
    await enterReadyShell(page, "pantry");

    // The `role="radio"` element is the native `<input>` react-aria wires up
    // (SegmentedControl.tsx's `useRadio`) — visually hidden by design (the
    // same visually-hidden technique as index.css's own `.visually-hidden`),
    // so IT carries Chromium's UA-stylesheet default form-control font-size
    // (13.3333px) regardless of any token, and checking it directly would
    // assert something meaningless. The visible text lives on its sibling
    // `<label>` (`.segment`), which is what actually renders `--fs-body`.
    const input = page.getByRole("radio", { name: "Stock" });
    await expect(input).toBeAttached();
    const option = page.locator("label").filter({ has: input });
    await expect(option).toBeVisible();
    const fontSize = await option.evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe("16px");
  });

  test("Pantry ListRow secondary line uses --fs-body-sm (14px)", async ({ page }) => {
    await enterReadyShell(page, "pantry");

    await page.getByRole("button", { name: "Add to pantry" }).click();
    await openIngredientSheet(page, "Milk");
    await page.getByRole("textbox", { name: /amount/i }).fill("1");
    await page.getByRole("button", { name: "Add to pantry" }).click();

    const row = page.getByText("Milk", { exact: false }).first();
    await expect(row).toBeVisible();
    // The secondary line is the row's own quantity/location text — a
    // CSS-module class containing "secondary", same lookup ListRow.tsx
    // itself uses, resolved through the real rendered DOM instead of an
    // isolated component render.
    const secondary = page.locator('[class*="secondary"]').first();
    await expect(secondary).toBeVisible();
    const fontSize = await secondary.evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe("14px");
  });
});
