import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { addPantryStock } from "./support/pantry.ts";
import { bridgedPath, createSharedWorkbookBackend } from "./support/shared-workbook.ts";

/**
 * Overrides `navigator.onLine` and fires the matching window event —
 * everything `createBrowserConnectivityMonitor` (src/sync/connectivity.ts)
 * actually reads — WITHOUT touching real network I/O the way
 * `context.setOffline()` does. That distinction matters here: `setOffline`
 * blocks the browser's real network stack wholesale, including this app's
 * OWN same-origin, code-split route chunks (Vite's dynamic `import()`
 * calls) that haven't been fetched yet — clicking further into the page
 * while "offline" that way can 500 on a lazy `import()` with no relation to
 * the Sheets mock at all. This test only wants the Sheets API calls to
 * fail (e2e/support/shared-workbook.ts's `setNetworkDown`, used alongside
 * this), not the app's own asset loading.
 */
async function setBrowserOnline(page: Page, online: boolean): Promise<void> {
  await page.evaluate((isOnline) => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => isOnline });
    window.dispatchEvent(new Event(isOnline ? "online" : "offline"));
  }, online);
}

// WP-30 (IMPLEMENTATION_PLAN.md): "Offline/outbox under concurrency: given
// PR #34, cover that events enqueued while a flush is in flight are not
// stranded." PR #34 fixed a real, reproducible data-loss bug (M6 barcode
// scan, PR #32/#33): `outbox-sync-controller.ts`'s `flushNow()` used to
// silently DROP a concurrent call — harmless for a duplicate request, but
// wrong the moment something was enqueued to the outbox AFTER the in-flight
// flush had already taken its `outbox.pending()` snapshot. That event was
// then invisible to the running flush AND to the dropped call, stranded
// indefinitely. `outbox-sync-controller.test.ts` proves the fix at the unit
// level (two synthetic `flushNow()` calls racing an injected delay); this
// spec is the E2E-level regression guard for the SAME failure mode as a
// household member would actually trigger it — two real "Add to pantry"
// submissions in quick succession while offline, each firing its own
// fire-and-forget `flushNow()` (usePantryInventory.ts), then reconnecting.
//
// Uses e2e/support/shared-workbook.ts's `setNetworkDown` rather than plain
// `context.setOffline()` (wp-24-offline-banner.spec.ts's approach) for the
// actual Sheets-call failure: `flushNow()` has no online check of its own
// (outbox-sync-controller.ts: "Runs one flush attempt now, regardless of
// the connectivity monitor's current state"), so without a bridge-level
// drop, both adds would just flush immediately and this scenario would
// never get to exercise an offline outbox at all. `setBrowserOnline` above
// drives the same `navigator.onLine`/window-event signal `setOffline()`
// would, for the real offline banner (also exercised by
// wp-24-offline-banner.spec.ts) — see that helper's own comment for why
// `setOffline()` itself isn't used here too.
//
// KNOWN BUG, reported to the coordinator rather than worked around here
// (2026-08-21): this scenario currently reproduces a DUPLICATE append, not
// a stranded one — the same Rice/Milk purchase event lands in
// InventoryEvents TWICE (confirmed by tracing byte-identical `:append`
// request bodies firing back to back), not zero times. Best evidence so
// far: opening "Add to pantry" for the first time in a session triggers a
// second, independent run of usePantryInventory.ts's `boot()` effect (each
// run constructs its OWN `createOutboxSyncController` and calls
// `controller.start()`) — if the first run's effect cleanup doesn't
// actually stop that first controller's online-event subscription before
// the second one starts, both stay alive and both flush the same pending
// events on reconnect. Fixing this is `usePantryInventory.ts` (and likely
// `useScanFlow.ts`, which builds its outbox/controller the identical way)
// effect/lifecycle work well past this package's remit — `test.fail()`
// below keeps this scenario asserting the CORRECT behaviour (exactly 2
// events, matching what PR #34's fix promises) rather than silently
// weakening the assertion to match the bug, while not blocking the suite.

test("two events enqueued while offline are not stranded — both land once reconnected", async ({ browser }) => {
  test.fail(
    true,
    "Reproduces a DUPLICATE append instead (see this file's header comment) — a separate, more severe bug than the one this scenario was written to guard, found while writing it and reported rather than worked around.",
  );
  const backend = createSharedWorkbookBackend({ spreadsheetId: "wp30-offline-outbox" });
  try {
    const ctx = await browser.newContext();
    const bridge = await backend.install(ctx);
    const page = await ctx.newPage();

    await enterReadyShell(page, bridgedPath("pantry"));

    // Warm-up, still online: the FIRST-ever mount of the add-lot form (a
    // lazy-loaded chunk) issues its own extra `Ingredients` read alongside
    // boot's — harmless online, but it would otherwise fire again during
    // the offline section below and confuse "did the outbox strand an
    // event" with "the catalog reload we didn't ask for also failed while
    // offline". Opening it once now and cancelling gets that one-time read
    // out of the way before this test's actual offline window starts.
    await page.getByRole("button", { name: "Add to pantry" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await setBrowserOnline(page, false);
    bridge.setNetworkDown(true);

    // Two "Add to pantry" submissions in quick succession while offline —
    // each one's own fire-and-forget `flushNow()` call is exactly the
    // scenario PR #34 fixed: the second call used to arrive while the
    // first's flush attempt was still in flight (here, still retrying
    // against the dropped connection) and be silently swallowed.
    await addPantryStock(page, "Rice", "500");
    await addPantryStock(page, "Milk", "200");

    // Optimistic UI shows both immediately regardless of sync state
    // (previewSnapshotWithPending, src/sync/sync.ts) — this alone doesn't
    // prove either one will actually reach the workbook.
    await expect(page.getByRole("main")).toContainText("500 g");
    await expect(page.getByRole("main")).toContainText("200 ml");

    // The offline banner itself is real (drives off the same
    // navigator.onLine/window-event signal as wp-24-offline-banner.spec.ts).
    // Its "N changes waiting to sync" COUNT is not asserted here, though:
    // that count only reflects writes made through AppShell's own
    // `countedOutbox` wrapper (App.tsx's own comment: "A route enqueues
    // through THIS wrapper ... purely so every enqueue also refreshes the
    // banner's count") — but `usePantryInventory` (and `useScanFlow`)
    // construct their OWN `createLocalStorageOutbox` directly instead of
    // using `useWorkbookContext().outbox`, so Pantry/Scan writes never
    // touch that counter. The banner correctly says "offline" here but
    // would incorrectly omit the pending count for exactly the writes this
    // test makes — a real, separate gap, out of this package's file
    // ownership to fix (App.tsx is WP-31's), reported rather than asserted
    // into this test as if it were the intended behaviour.
    const syncBanner = page.getByRole("status").filter({ hasText: /offline/i });
    await expect(syncBanner).toContainText("You're offline.");

    // Reconnect — both the real browser signal (drives the controller's own
    // online-transition auto-flush, outbox-sync-controller.ts's `start()`)
    // and this backend's gate.
    bridge.setNetworkDown(false);
    await setBrowserOnline(page, true);

    // Both events actually reach the workbook — checked directly against
    // the backend's own InventoryEvents log (not the UI's optimistic view,
    // and not the broken pending-count banner above) so this polls for the
    // real, authoritative outcome: neither the Rice nor the Milk purchase
    // event was stranded by PR #34's original bug, after the coalesced
    // rerun's retry/backoff cycles complete.
    await expect
      .poll(async () => (await backend.store.inventoryEvents.readFrom(0)).rows.length, { timeout: 15_000 })
      .toBe(2);

    // And a fresh client (this app never persists the access token, so
    // re-entering re-syncs from the workbook rather than reading back this
    // page's own optimistic state) confirms both lots are visible, not just
    // present as raw event rows.
    await enterReadyShell(page, bridgedPath("pantry"));
    await expect(page.getByRole("main")).toContainText("500 g");
    await expect(page.getByRole("main")).toContainText("200 ml");
  } finally {
    backend.close();
  }
});
