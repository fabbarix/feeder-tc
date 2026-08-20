import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// WP-24-UI: proves AppShell's offline banner (UI_DESIGN.md §8) is wired to
// REAL browser connectivity through the REAL `App.tsx` container
// (`createBrowserConnectivityMonitor` — `navigator.onLine` + the
// online/offline window events), not just to a prop in a component test.
// Deliberately does not depend on WP-23's shopping list (which does not
// exist yet — see IMPLEMENTATION_PLAN.md WP-24's note and the WP-24-UI
// handover report): going offline and back needs no pending writes at all,
// only the "chromium" project's dev-server + msw stack that `enterReadyShell`
// already exercises for WP-20's own E2E specs.
test.describe("offline/online banner reacts to real browser connectivity (UI_DESIGN.md §8)", () => {
  test("shows 'You're offline' when the network goes down, and clears when it returns", async ({ page, context }) => {
    await enterReadyShell(page);

    // Filtered by text, not just `role=status` — workbook creation also
    // fires toasts (also `role="status"`, see ToastViewport) that can still
    // be visible at this point, and this test only cares about the sync
    // banner specifically. Not `getByRole(..., { name })`: `status`'s
    // accessible name is "from author" only per the ARIA spec (aria-label/
    // aria-labelledby), not from content, so a plain text-content match is
    // what actually finds this banner.
    const banner = page.getByRole("status").filter({ hasText: /offline/i });
    await expect(banner).toHaveCount(0);

    await context.setOffline(true);
    // `context.setOffline` flips `navigator.onLine` and fires the window
    // `offline` event asynchronously — wait for the browser-level signal
    // itself before asserting on the UI it drives, so this doesn't race a
    // slow CDP round-trip against the assertion's own timeout.
    await page.waitForFunction(() => !navigator.onLine);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("aria-live", "polite");
    // Pending is normal, not an error — offline alone (nothing queued) must
    // never claim anything is "waiting to sync" (UI_DESIGN.md §8).
    await expect(banner).not.toContainText(/waiting to sync/i);

    await context.setOffline(false);
    await page.waitForFunction(() => navigator.onLine);
    await expect(banner).toHaveCount(0);
  });
});
