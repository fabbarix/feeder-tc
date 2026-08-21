import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DEFAULT_SETTINGS, WORKBOOK_SHEET_NAMES } from "../src/sheets/index.ts";
import type { WorkbookSheetName } from "../src/domain/types.ts";
import { enterReadyShell } from "./support/shell.ts";
import { bridgedPath, createSharedWorkbookBackend } from "./support/shared-workbook.ts";

// WP-30 (IMPLEMENTATION_PLAN.md): "Stale-workbook coverage, using PR #36's
// `existingSheets`: a workbook missing a newer tab must migrate and work,
// not crash." This is the production bug PR #36 fixed (README of
// src/sheets/mocks/handlers.ts, and unit-level regression coverage in
// src/sheets/stale-workbook.test.ts): a workbook bootstrapped before M6-A/
// WP-PHOTO added the `Products`/`Photos`/`PriceObservations` tabs 400s the
// moment anything reads one of them, because reading a tab that doesn't
// exist used to rethrow a bare `SheetsHttpError` instead of tolerating it.
// stale-workbook.test.ts proves the FIX at the transport/store level; this
// spec is the missing E2E layer — through the REAL UI, proving the whole
// "open it -> migrate in the background -> the route that used to crash
// renders instead" loop, not just that the read call itself resolves.
//
// Uses e2e/support/shared-workbook.ts (not the standard single-page mock)
// for the same reason wp-30-generation-bump.spec.ts does: this needs
// Node-side control to seed a workbook's rows BEFORE any page ever opens
// it, modelling one that was bootstrapped years ago under an older schema —
// something a single page's own in-page fake can't be pre-loaded with from
// outside itself.

const MISSING: readonly WorkbookSheetName[] = ["Products", "Photos", "PriceObservations"];

async function openViaPicker(page: Page): Promise<void> {
  await page.goto(bridgedPath());
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await page.getByRole("button", { name: "Open existing…" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({ timeout: 20_000 });
}

test("a workbook created before the current schema migrates on open instead of crashing the scan route", async ({
  browser,
}) => {
  const backend = createSharedWorkbookBackend({
    spreadsheetId: "wp30-stale-workbook",
    existingSheets: WORKBOOK_SHEET_NAMES.filter((sheet) => !MISSING.includes(sheet)),
  });
  try {
    // Seeded the way a real, already-in-use pre-M6-A/WP-PHOTO workbook would
    // be: Meta + Settings have real content (it was bootstrapped once, long
    // ago, under whatever schema existed then) — only the tabs a LATER
    // schema change introduced are genuinely absent, never having had the
    // chance to be created.
    await backend.store.meta.write({ schemaVersion: 1, generation: 1 });
    await backend.store.settings.write(DEFAULT_SETTINGS);

    const missingBefore = new Set(await backend.listSheets());
    for (const sheet of MISSING) expect(missingBefore.has(sheet)).toBe(false);

    const ctx = await browser.newContext();
    await backend.install(ctx);
    const page = await ctx.newPage();
    await openViaPicker(page);

    // The historical bug's exact call site: the scan route's boot reads
    // `store.products.readAll()` among others (useScanFlow.ts's `boot()`,
    // mirrored by stale-workbook.test.ts's own second scenario). A fresh
    // `enterReadyShell` call, not a bare `page.goto()`: this app never
    // persists the access token, so a real navigation always drops back to
    // signed-out (shell.ts's own doc comment) — the registry already has
    // this workbook active from `openViaPicker`, so signing back in lands
    // straight on /scan without needing "Open existing…" again.
    await enterReadyShell(page, bridgedPath("scan"));
    await expect(page.getByRole("heading", { name: "Scan a barcode" })).toBeVisible({ timeout: 10_000 });
    // Not the crash this fix replaced ("Couldn't load your catalog").
    await expect(page.getByRole("alert")).toHaveCount(0);

    // And the background migration (App.tsx's fire-and-forget
    // `ensureWorkbookSchema` effect, run whenever a workbook is opened) adds
    // the missing tabs — not inferred only from "the UI didn't crash", but
    // proven directly against the backend's own tab list.
    await expect
      .poll(async () => (await backend.listSheets()).length, { timeout: 10_000 })
      .toBe(WORKBOOK_SHEET_NAMES.length);
    const sheetsAfter = new Set(await backend.listSheets());
    for (const sheet of MISSING) expect(sheetsAfter.has(sheet)).toBe(true);
  } finally {
    await backend.close();
  }
});
