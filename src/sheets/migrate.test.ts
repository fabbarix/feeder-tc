/**
 * `ensureWorkbookSchema` (migrate.ts) — brings a stale workbook (one missing
 * a WorkbookSheetName tab a later work package added) up to date when it is
 * opened, rather than only ever at creation time. Exercised over the real
 * HTTP-shaped transport (msw), since the whole point of this function is
 * the `spreadsheets.get` round trip `listSheetTitles` makes — the in-memory
 * domain fake has no such concept.
 */
import { describe, expect, it } from "vitest";
import { server } from "../mocks/server.ts";
import { WORKBOOK_SHEET_NAMES } from "./bootstrap.ts";
import { columnLetter, WORKBOOK_HEADERS } from "./codecs/index.ts";
import { ensureWorkbookSchema } from "./migrate.ts";
import { createSheetsApiHandlers } from "./mocks/handlers.ts";
import { createGoogleSheetsTransport, type SheetsAuthAdapter } from "./transport.ts";

const ACCESS_TOKEN = "migrate-test-token";
let nextId = 0;

function makeClient(spreadsheetId: string, onFetch?: () => void) {
  const auth: SheetsAuthAdapter = { getAccessToken: async () => ACCESS_TOKEN, invalidate: () => {} };
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    onFetch?.();
    return fetch(input, init);
  }) as typeof fetch;
  const transport = createGoogleSheetsTransport({ spreadsheetId, auth, fetchImpl, sleep: async () => {} });
  return { auth, transport, fetchImpl };
}

describe("ensureWorkbookSchema", () => {
  it("creates every missing tab with its header row on a stale workbook", async () => {
    const spreadsheetId = `migrate-sheet-${(nextId += 1)}`;
    server.use(
      ...createSheetsApiHandlers({
        spreadsheetId,
        accessToken: ACCESS_TOKEN,
        existingSheets: WORKBOOK_SHEET_NAMES.filter(
          (sheet) => sheet !== "Products" && sheet !== "Photos" && sheet !== "PriceObservations",
        ),
      }),
    );
    const { auth, transport, fetchImpl } = makeClient(spreadsheetId);

    const result = await ensureWorkbookSchema({ spreadsheetId, auth, transport, fetchImpl });

    expect(new Set(result.createdSheets)).toEqual(new Set(["Products", "Photos", "PriceObservations"]));
    for (const sheet of ["Products", "Photos", "PriceObservations"] as const) {
      const header = WORKBOOK_HEADERS[sheet];
      const lastCol = columnLetter(header.length);
      // Read directly (not through readRange's own missing-tab tolerance)
      // to prove the tab genuinely exists now, not merely that a read of it
      // no longer throws.
      const row = await transport.readRange(`${sheet}!A1:${lastCol}1`);
      expect(row).toEqual([header]);
    }
  });

  it("is a no-op - one round trip, zero writes - when the workbook already has every tab", async () => {
    const spreadsheetId = `migrate-sheet-${(nextId += 1)}`;
    server.use(...createSheetsApiHandlers({ spreadsheetId, accessToken: ACCESS_TOKEN }));
    let fetchCount = 0;
    const { auth, transport, fetchImpl } = makeClient(spreadsheetId, () => {
      fetchCount += 1;
    });

    const result = await ensureWorkbookSchema({ spreadsheetId, auth, transport, fetchImpl });

    expect(result.createdSheets).toEqual([]);
    // Exactly the one listSheetTitles round trip - no batchUpdate, no
    // per-sheet header PUT. "Do not add a slow or chatty step to every
    // workbook open" (the task's own words) means this must not scale with
    // the number of sheets in the happy case.
    expect(fetchCount).toBe(1);
  });

  it("two clients racing to migrate the same stale workbook both succeed, and the tab ends up created exactly once", async () => {
    const spreadsheetId = `migrate-sheet-${(nextId += 1)}`;
    server.use(
      ...createSheetsApiHandlers({
        spreadsheetId,
        accessToken: ACCESS_TOKEN,
        existingSheets: WORKBOOK_SHEET_NAMES.filter((sheet) => sheet !== "Products"),
      }),
    );
    const client1 = makeClient(spreadsheetId);
    const client2 = makeClient(spreadsheetId);

    const [result1, result2] = await Promise.all([
      ensureWorkbookSchema({
        spreadsheetId,
        auth: client1.auth,
        transport: client1.transport,
        fetchImpl: client1.fetchImpl,
      }),
      ensureWorkbookSchema({
        spreadsheetId,
        auth: client2.auth,
        transport: client2.transport,
        fetchImpl: client2.fetchImpl,
      }),
    ]);

    // Neither call throws (the "already exists" 400 one of them gets back
    // from addSheet is tolerated, exactly like ensureSheetExists already
    // tolerates it for appendRows' own fallback), and both agree the tab
    // was (from their point of view) created.
    expect(result1.createdSheets).toEqual(["Products"]);
    expect(result2.createdSheets).toEqual(["Products"]);

    const header = WORKBOOK_HEADERS.Products;
    const lastCol = columnLetter(header.length);
    const row = await client1.transport.readRange(`Products!A1:${lastCol}1`);
    expect(row).toEqual([header]);
  });
});
