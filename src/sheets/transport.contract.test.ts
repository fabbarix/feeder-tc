/**
 * Re-runs the shared SheetsTransport contract suite (src/domain/contract-
 * tests/sheets-transport.contract.ts) against the real Sheets-REST-API-
 * backed implementation, over msw (never a real Google endpoint - see
 * TESTING.md). Each `makeSubject()` call gets its own unique spreadsheetId
 * and its own fresh in-memory mock spreadsheet, matching the isolation the
 * fake's own contract test relies on (src/domain/fakes/sheets-transport.test.ts).
 */
import { describeSheetsTransportContract } from "../domain/contract-tests/index.ts";
import { server } from "../mocks/server.ts";
import { createSheetsApiHandlers } from "./mocks/handlers.ts";
import { createGoogleSheetsTransport } from "./transport.ts";

const ACCESS_TOKEN = "contract-test-token";
let nextId = 0;

describeSheetsTransportContract(() => {
  const spreadsheetId = `contract-sheet-${(nextId += 1)}`;
  server.use(...createSheetsApiHandlers({ spreadsheetId, accessToken: ACCESS_TOKEN }));
  return createGoogleSheetsTransport({
    spreadsheetId,
    auth: { getAccessToken: async () => ACCESS_TOKEN, invalidate: () => {} },
    sleep: async () => {},
  });
});
