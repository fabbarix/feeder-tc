/**
 * Brings an EXISTING workbook up to the current schema when it is opened —
 * the counterpart to `bootstrap.ts`'s `bootstrapWorkbook`, which only ever
 * runs once, at creation time (`App.tsx`'s `handleCreateWorkbook`).
 *
 * A workbook opened via the Picker (or restored from the registry on a page
 * reload) may predate one or more `WorkbookSheetName` tabs the schema has
 * since grown (M6-A's `Products`/`PriceObservations`, WP-PHOTO's `Photos`) —
 * that spreadsheet file was created with the tab list `spreadsheet.ts` wrote
 * at ITS creation time, and nothing ever goes back to add a tab a later
 * schema change introduced. `readRange`/`batchRead` (transport.ts) already
 * tolerate a missing tab by treating it as merely empty, so a read-only
 * screen never crashes on a stale workbook even before this runs — but
 * without this, the tab itself (and its header row — invariant 6) would only
 * ever appear the first time something happens to WRITE to it, if ever. A
 * read-only route (the scan route's `products.readAll()`, the production bug
 * this whole fix exists for) might never trigger that.
 *
 * Efficient by construction: one `listSheetTitles` round trip to find out
 * what is actually missing, and zero further writes when nothing is (the
 * common case, every time this runs against an already-current workbook).
 * Callers (`App.tsx`) run this fire-and-forget in the background — it must
 * never block first paint or gate a route mounting, since every reader
 * already tolerates the "not migrated yet" state on its own.
 */
import type { SheetsTransport } from "../domain/contracts.ts";
import type { WorkbookSheetName } from "../domain/types.ts";
import { WORKBOOK_SHEET_NAMES } from "./bootstrap.ts";
import { columnLetter, WORKBOOK_HEADERS } from "./codecs/index.ts";
import { ensureSheetExists, listSheetTitles, type SheetsAuthAdapter } from "./transport.ts";

export interface EnsureWorkbookSchemaOptions {
  readonly spreadsheetId: string;
  readonly auth: SheetsAuthAdapter;
  readonly transport: SheetsTransport;
  /** Injected for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export interface EnsureWorkbookSchemaResult {
  /** Which tabs were found missing and have now been created (with their header row). Empty on an already-current workbook. */
  readonly createdSheets: readonly WorkbookSheetName[];
}

/**
 * Creates every `WorkbookSheetName` tab this spreadsheet is missing, each
 * with its header row already written. Concurrency-safe the same way
 * `appendRows`'s own missing-tab fallback is: `ensureSheetExists` treats
 * "already exists" (a second client racing to fix the same stale workbook)
 * as success, and writing the same header content twice is idempotent.
 */
export async function ensureWorkbookSchema(options: EnsureWorkbookSchemaOptions): Promise<EnsureWorkbookSchemaResult> {
  const { spreadsheetId, auth, transport, fetchImpl } = options;
  // Built with a conditional spread, not `{ auth, fetchImpl }` directly, so
  // an absent `fetchImpl` stays genuinely absent rather than an explicit
  // `undefined` property - exactOptionalPropertyTypes rejects the latter
  // against `listSheetTitles`'s `Pick<CreateSheetsTransportOptions, ...>`
  // parameter (see transport.ts's own `retryOptions` comment for the same
  // pattern).
  const existing = new Set(await listSheetTitles(spreadsheetId, { auth, ...(fetchImpl ? { fetchImpl } : {}) }));
  const missing = WORKBOOK_SHEET_NAMES.filter((sheet) => !existing.has(sheet));
  if (missing.length === 0) return { createdSheets: [] };

  for (const sheet of missing) {
    await ensureSheetExists(spreadsheetId, sheet, auth, fetchImpl ?? fetch);
    const header = WORKBOOK_HEADERS[sheet];
    const lastCol = columnLetter(header.length);
    await transport.updateRange(`${sheet}!A1:${lastCol}1`, [header]);
  }

  return { createdSheets: missing };
}
