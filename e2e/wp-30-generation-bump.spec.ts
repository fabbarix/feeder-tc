import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { addPantryStock } from "./support/pantry.ts";
import { bridgedPath, createSharedWorkbookBackend } from "./support/shared-workbook.ts";

// WP-30 (IMPLEMENTATION_PLAN.md): "add generation-bump scenario (client
// rebuilds cleanly)" — HANDOVER.md invariant 2: "Any client whose cached
// `generation` mismatches `Meta` must discard its snapshot and re-read
// fully." No feature in this app actually compacts InventoryEvents yet
// (HANDOVER §4 describes compaction as "a deliberate operation" for a
// future WP), so this bumps `Meta.generation` directly — exactly the
// observable effect a real compaction has on every OTHER client's cursor
// safety check, which is all `src/sync/sync.ts`'s `syncSnapshot` actually
// looks at.
//
// Uses e2e/support/shared-workbook.ts even though this scenario is
// single-CLIENT, because it needs a real page RELOAD (re-opening the app
// "the next day", after a compaction ran overnight) — and reload is exactly
// where the standard src/mocks/handlers.ts msw browser worker falls apart
// for this purpose: a full navigation re-runs `main.tsx` from scratch,
// which rebuilds `setupWorker(...handlers)` and therefore a BRAND NEW
// `createFakeSheetsTransport()` with an EMPTY grid — discovered by tracing
// requests here: a `page.goto()` reload alone (before even signing back in)
// already reads back "Meta sheet has no data row", not a generation
// mismatch. That in-page fake was never meant to survive a reload (nothing
// in the single-page suite relies on it doing so — every other spec's
// "reload" is a client-side route change, not a real navigation); modelling
// "the same workbook, still there after this page reloads" needs the same
// Node-side backend the multi-client spec uses, for the same reason.

test("a client whose cached generation no longer matches Meta discards its snapshot and rebuilds cleanly (invariant 2)", async ({
  browser,
}) => {
  const backend = createSharedWorkbookBackend({ spreadsheetId: "wp30-generation-bump" });
  try {
    const ctx = await browser.newContext();
    await backend.install(ctx);
    const page = await ctx.newPage();

    await enterReadyShell(page, bridgedPath("pantry"));
    await addPantryStock(page, "Rice", "300");
    await expect(page.getByRole("main")).toContainText("300 g");

    const cacheKey = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith("feeder:snapshot:v1:")));
    expect(cacheKey).toBeTruthy();
    const generationBefore = await page.evaluate(
      (key) => (JSON.parse(localStorage.getItem(key!) ?? "{}") as { generation?: number }).generation,
      cacheKey,
    );
    expect(generationBefore).toBe(1);

    // Simulate a compaction happening elsewhere, over the real WorkbookStore
    // contract, directly against this backend's Node-side state.
    const meta = await backend.store.meta.read();
    await backend.store.meta.write({ ...meta, generation: meta.generation + 1 });

    // This app never persists the access token, so re-entering is a real
    // fresh navigation + re-sign-in — the next thing this page does is a
    // genuine reload of everything, same as a household member opening the
    // app tomorrow after someone else compacted the workbook overnight.
    await enterReadyShell(page, bridgedPath("pantry"));

    // Rebuilds cleanly: no crash, and the SAME data as before (the fold from
    // a full re-read of cursor 0 against unchanged InventoryEvents produces
    // the identical lots a generation bump alone doesn't touch) — not
    // empty, not duplicated.
    await expect(page.getByRole("main")).not.toContainText("Couldn't load");
    await expect(page.getByRole("main")).toContainText("300 g");
    await expect(page.getByRole("link", { name: /Rice/ })).toHaveCount(1);

    // And the cache was genuinely discarded and rebuilt against the new
    // generation, not just left stale and coincidentally still correct.
    const generationAfter = await page.evaluate(
      (key) => (JSON.parse(localStorage.getItem(key!) ?? "{}") as { generation?: number }).generation,
      cacheKey,
    );
    expect(generationAfter).toBe(2);
  } finally {
    await backend.close();
  }
});
