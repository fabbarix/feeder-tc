import { expect, test, type Locator, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { TIERS } from "./support/viewports.ts";

/**
 * Regression test (WP-tokens): no `SegmentedControl` may render as a 999px
 * pill while spanning more than one row.
 *
 * Owner-reported, caught by measuring the Plan route's "Week"/"Month"
 * switcher at 390px: it wrapped onto two rows while keeping the default
 * pill radius, rendering as a lozenge blob — exactly the failure mode
 * `SegmentedControl.module.css`'s `wraps` prop exists to prevent (see that
 * file's long comment on `.group`/`.group.wrap`). Root cause: `.group`'s
 * `repeat(auto-fit, minmax(72px, 1fr))` grid has no reliable intrinsic
 * (shrink-to-fit) width of its own — a consumer that doesn't hand it a
 * DEFINITE width some other way (Pantry's rail via `width:100%`, a
 * `flex-direction:column` field where the browser's default
 * `align-items:stretch` fills the column) gets sized down to a single 72px
 * column by the browser's (mis)answer to that intrinsic-size query, and the
 * grid silently wraps inside that shrunk box. Plan.tsx's switcher is a bare
 * item in a `flex-direction:row` group with no stretch and no width — the
 * one shape that hits this. Fixed via `--segment-count` (SegmentedControl.tsx)
 * feeding an explicit `min-width` on `.group` (SegmentedControl.module.css),
 * neutralised under `.group.wrap` so Pantry's genuinely-narrower-than-one-row
 * rail keeps wrapping on purpose.
 *
 * This spec asserts the INVARIANT directly — "pill radius implies one row"
 * — on every `role="radiogroup"` reachable from a handful of representative
 * routes, at every tier, rather than re-testing one specific control. A
 * future consumer placed in the same unprotected shape (a bare flex-row
 * item, no stretch, no width) would fail this before a reviewer had to spot
 * it in a screenshot.
 */

const PILL_RADIUS = "999px";

async function assertNeverWrappedPill(group: Locator, context: string): Promise<void> {
  const radius = await group.evaluate((el) => getComputedStyle(el).borderRadius);
  if (!radius.split(" ").every((r) => r === PILL_RADIUS)) return; // not a pill right now (e.g. `wraps`) — nothing to check

  const box = await group.boundingBox();
  expect(box, `${context}: could not measure a visible pill control`).not.toBeNull();

  // A single-row pill's height is governed by `--touch-target` minus 8px
  // (SegmentedControl.module.css's `.segment { min-height: calc(var(--touch-target) - 8px) }`)
  // plus its own hairline padding/border — comfortably under 60px. Two rows
  // at least doubles that. No need to introspect child rows directly: the
  // pill radius + a height that can only mean "more than one row" is
  // exactly the failure shape, and this threshold has generous headroom on
  // both sides (a real single row here is ~44-48px; a real wrap is ~90px+).
  const ONE_ROW_MAX_HEIGHT = 64;
  expect(
    box!.height,
    `${context}: pill-radius SegmentedControl measured ${box!.height}px tall — looks wrapped onto more than one row while still a 999px pill (lozenge-blob regression)`,
  ).toBeLessThanOrEqual(ONE_ROW_MAX_HEIGHT);
}

async function sweepPage(page: Page, context: string): Promise<void> {
  const groups = page.locator('[role="radiogroup"]');
  // `.count()` does not auto-wait — react-aria attaches `role="radiogroup"`
  // after mount, not on first paint, so counting immediately after a
  // navigation can race the attribute onto the DOM and silently sweep zero
  // elements (caught only by deliberately reverting the fix under test and
  // watching this spec keep passing — it should not). Every route this
  // spec visits has at least one SegmentedControl, so wait for the first
  // one to attach before trusting the count; a route added later with
  // genuinely none would still just time out into an empty sweep, not a
  // false pass on ones that exist.
  await groups
    .first()
    .waitFor({ state: "attached", timeout: 10_000 })
    .catch(() => undefined);
  const count = await groups.count();
  for (let i = 0; i < count; i++) {
    const group = groups.nth(i);
    if (!(await group.isVisible())) continue;
    const label = (await group.getAttribute("aria-label")) ?? (await group.getAttribute("aria-labelledby")) ?? `#${i}`;
    await assertNeverWrappedPill(group, `${context} — "${label}"`);
  }
}

test.describe("No SegmentedControl keeps the 999px pill radius while wrapped onto multiple rows", () => {
  for (const tier of TIERS) {
    test(`${tier.name} (${tier.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: tier.width, height: tier.height });

      await enterReadyShell(page, "plan");
      await sweepPage(page, `Plan @ ${tier.width}px`);

      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Pantry", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Pantry" })).toBeVisible();
      await sweepPage(page, `Pantry @ ${tier.width}px`);

      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      await sweepPage(page, `Settings @ ${tier.width}px`);
    });
  }
});
