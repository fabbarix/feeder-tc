/**
 * Regression coverage for the production bug this branch fixes: opening the
 * scan route ("Couldn't load your catalog — Sheets API request failed with
 * 400") happened because `store.products.readAll()` read a tab
 * (`Products`) that didn't exist on a workbook created before M6-A. Exercised
 * at the `WorkbookStore` level, over the real HTTP-shaped transport (msw),
 * so this proves the fix end to end rather than only at transport.ts's own
 * unit level.
 *
 * This file's tests were run against this branch's PRE-fix `transport.ts`
 * (readRange/batchRead rethrowing a bare `SheetsHttpError` on a missing
 * tab) and failed exactly as the bug report describes, confirming they are
 * a genuine regression test and not one that would have passed either way.
 */
import { describe, expect, it } from "vitest";
import { makeProductId } from "../domain/types.ts";
import { server } from "../mocks/server.ts";
import { DEFAULT_SETTINGS, WORKBOOK_SHEET_NAMES } from "./bootstrap.ts";
import { createSheetsApiHandlers } from "./mocks/handlers.ts";
import { createGoogleSheetsTransport } from "./transport.ts";
import { createSheetsWorkbookStore } from "./workbook-store.ts";

const ACCESS_TOKEN = "stale-workbook-test-token";
let nextId = 0;

function makeStaleStore(missingSheets: readonly string[]) {
  const spreadsheetId = `stale-sheet-${(nextId += 1)}`;
  server.use(
    ...createSheetsApiHandlers({
      spreadsheetId,
      accessToken: ACCESS_TOKEN,
      existingSheets: WORKBOOK_SHEET_NAMES.filter((sheet) => !missingSheets.includes(sheet)),
    }),
  );
  const transport = createGoogleSheetsTransport({
    spreadsheetId,
    auth: { getAccessToken: async () => ACCESS_TOKEN, invalidate: () => {} },
    sleep: async () => {},
  });
  return createSheetsWorkbookStore(transport);
}

describe("a workbook created before the current schema (a missing tab)", () => {
  it("products.readAll() resolves to an empty result instead of throwing", async () => {
    const store = makeStaleStore(["Products"]);

    await expect(store.products.readAll()).resolves.toEqual({ rows: [], warnings: [] });
  });

  it("the scan route's own boot sequence (ingredients + products + recipes + recipeIngredients + planSlots + settings, read together) survives a workbook missing Products", async () => {
    const store = makeStaleStore(["Products"]);
    // A real stale workbook's OLDER sheets already have real content from
    // whenever it actually was bootstrapped - only the tab introduced by a
    // later schema change (Products, here) is genuinely absent. Settings
    // has no "missing tab" fallback of its own (a workbook with no Settings
    // data at all was simply never bootstrapped, a different failure this
    // fix doesn't change) - write it first so this reproduces the realistic
    // case, not a never-bootstrapped one.
    await store.settings.write(DEFAULT_SETTINGS);

    // Mirrors useScanFlow.ts's boot() Promise.all exactly - the actual call
    // site of the production bug.
    await expect(
      Promise.all([
        store.ingredients.readAll(),
        store.products.readAll(),
        store.recipes.readAll(),
        store.recipeIngredients.readAll(),
        store.planSlots.readAll(),
        store.settings.read(),
      ]),
    ).resolves.toEqual([
      { rows: [], warnings: [] },
      { rows: [], warnings: [] },
      { rows: [], warnings: [] },
      { rows: [], warnings: [] },
      { rows: [], warnings: [] },
      DEFAULT_SETTINGS,
    ]);
  });

  it("holds for every M6-A/WP-PHOTO/WP-PRODUCTS-MODEL tab a pre-schema workbook might be missing, not just Products", async () => {
    const store = makeStaleStore(["Products", "ProductBarcodes", "Photos", "PriceObservations"]);

    await expect(store.products.readAll()).resolves.toEqual({ rows: [], warnings: [] });
    await expect(store.productBarcodes.readAll()).resolves.toEqual({ rows: [], warnings: [] });
    await expect(store.priceObservations.readAll()).resolves.toEqual({ rows: [], warnings: [] });
    await expect(store.photos.get("product", makeProductId("8001120000123"))).resolves.toBeUndefined();
  });
});
