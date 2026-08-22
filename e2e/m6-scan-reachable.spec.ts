import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

/**
 * `@e2e` — the barcode scanner must be REACHABLE at every width.
 *
 * Owner-reported: opening Shopping on an iPad offered no way to scan at all.
 * `shopping.module.css` hides the FAB from 768px up — correct, a thumb-reach
 * control makes no sense once there is a top bar — but nothing replaced it,
 * so the whole feature was unreachable on tablet and desktop. The only
 * remaining route to `/scan` was a link buried on the price-history page.
 *
 * Every other M6 spec navigates to `/scan` directly or clicks the phone FAB,
 * so a hidden button with no replacement passed the entire suite. This spec
 * exists to make "the entry point exists" a tested property rather than an
 * assumed one, at each tier the design defines:
 *
 *   phone   (≤767px)  — the FAB
 *   tablet  (768–1439) — a page action
 *   desktop (≥1440)    — a page action
 *
 * The assertion is deliberately about REACHABILITY (an enabled control whose
 * accessible name says what it does, that actually routes to /scan), not
 * about which element renders it — so a future redesign that moves the
 * affordance still passes, while removing it fails.
 */
const TIERS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "desktop", width: 1512, height: 950 },
] as const;

for (const tier of TIERS) {
  test(`Scan is reachable from Shopping at ${tier.name} (${tier.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: tier.width, height: tier.height });
    await enterReadyShell(page, "/shopping");

    const scan = page.getByRole("button", { name: /scan a barcode/i });
    await expect(scan, `no reachable scan control at ${tier.width}px`).toBeVisible();
    await expect(scan).toBeEnabled();

    await scan.click();
    await expect(page).toHaveURL(/\/scan$/);
  });
}

test("exactly one scan control is visible at a time — never two", async ({ page }) => {
  // The FAB and the page action are mirror-image media queries. If either
  // breakpoint is edited without the other, both could show at once (visually
  // duplicated) or neither (the original bug). Pin the invariant itself.
  for (const tier of TIERS) {
    await page.setViewportSize({ width: tier.width, height: tier.height });
    await enterReadyShell(page, "/shopping");
    const visible = await page.getByRole("button", { name: /scan a barcode/i }).count();
    expect(visible, `${tier.name} (${tier.width}px) should render exactly one scan control`).toBe(1);
  }
});
