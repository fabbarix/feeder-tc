/**
 * Re-runs the shared WorkbookStore contract suite through the real
 * Sheets-REST-API-backed transport (transport.ts), over msw (never a real
 * Google endpoint — see TESTING.md), the same pattern as
 * transport.contract.test.ts. This is the extra layer the in-memory-only
 * workbook-store.contract.test.ts can't cover: every value actually
 * round-trips through an HTTP JSON request/response (numbers, booleans,
 * `null`s) rather than living in a JS object the whole time.
 */
import { describeWorkbookStoreContract } from "../domain/contract-tests/index.ts";
import { server } from "../mocks/server.ts";
import { createSheetsApiHandlers } from "./mocks/handlers.ts";
import { createGoogleSheetsTransport } from "./transport.ts";
import { createSheetsWorkbookStore } from "./workbook-store.ts";

const ACCESS_TOKEN = "workbook-store-contract-token";
let nextId = 0;

describeWorkbookStoreContract(() => {
  const spreadsheetId = `workbook-store-contract-sheet-${(nextId += 1)}`;
  server.use(...createSheetsApiHandlers({ spreadsheetId, accessToken: ACCESS_TOKEN }));
  const transport = createGoogleSheetsTransport({
    spreadsheetId,
    auth: { getAccessToken: async () => ACCESS_TOKEN, invalidate: () => {} },
    sleep: async () => {},
  });
  return createSheetsWorkbookStore(transport);
});
