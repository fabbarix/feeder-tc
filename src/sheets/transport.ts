/**
 * SheetsTransport implementation over the Google Sheets REST API v4 (WP-10).
 * Raw, range-based, entity-blind - see src/domain/contracts.ts's header
 * comment. Must pass describeSheetsTransportContract (src/domain/contract-
 * tests/sheets-transport.contract.ts) unmodified.
 *
 * Every request carries only the OAuth bearer token from `auth`. The Picker
 * API key (VITE_GOOGLE_API_KEY) is never read here - see picker.ts, the only
 * place it is allowed to appear (merge-review checklist item).
 */
import type { CellGrid, CellRow, SheetsTransport } from "../domain/contracts.ts";
import type { WorkbookSheetName } from "../domain/types.ts";
import { columnLetter, WORKBOOK_HEADERS } from "./codecs/index.ts";
import { ReAuthRequiredError, SheetsHttpError } from "./errors.ts";

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/** The subset of GoogleAuth the transport needs - auth.ts's GoogleAuth structurally satisfies this. */
export interface SheetsAuthAdapter {
  getAccessToken(): Promise<string>;
  invalidate(): void;
}

export interface CreateSheetsTransportOptions {
  readonly spreadsheetId: string;
  readonly auth: SheetsAuthAdapter;
  /** Injected for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injected for tests, so retry tests don't actually wait; defaults to a real setTimeout-based sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Retries attempted for 429/5xx/401 before giving up. Default 3 (4 attempts total). */
  readonly maxRetries?: number;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter, used when the response carries no Retry-After. */
function backoffMs(attempt: number): number {
  const base = 300 * 2 ** attempt;
  const jitter = Math.random() * 150;
  return Math.min(base + jitter, 8_000);
}

/** Retry-After is seconds-since-response per RFC 9110; Sheets/Google APIs always send the numeric form. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

interface RequestFailure {
  readonly status: number;
  readonly text: string;
}

/**
 * Fetches with the shared retry policy:
 *  - 429/5xx: retried with Retry-After (if present) or exponential backoff.
 *  - 401: token is invalidated and a fresh one fetched, retried once per
 *    attempt budget; if it keeps happening the whole budget is spent and we
 *    surface ReAuthRequiredError instead of a generic HTTP error, since no
 *    amount of retrying fixes an expired/revoked session.
 */
async function requestWithRetry(
  buildRequest: (accessToken: string) => Request,
  options: Pick<CreateSheetsTransportOptions, "auth" | "fetchImpl" | "sleep" | "maxRetries">,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? realSleep;
  const maxRetries = options.maxRetries ?? 3;

  for (let attempt = 0; ; attempt += 1) {
    let accessToken: string;
    try {
      accessToken = await options.auth.getAccessToken();
    } catch (err) {
      // getAccessToken() already exhausted its own recovery (silent refresh);
      // there is nothing left for the transport to retry.
      throw err instanceof ReAuthRequiredError ? err : new ReAuthRequiredError();
    }

    const response = await fetchImpl(buildRequest(accessToken));
    if (response.ok) return response;

    // 401 always maps to ReAuthRequiredError, not a generic SheetsHttpError -
    // no amount of retrying fixes an expired/revoked session, and callers
    // need to be able to route the user back to sign-in specifically.
    if (response.status === 401) {
      options.auth.invalidate();
      if (attempt < maxRetries) continue;
      throw new ReAuthRequiredError();
    }
    if (isRetryableStatus(response.status) && attempt < maxRetries) {
      const delay = retryAfterMs(response.headers.get("Retry-After")) ?? backoffMs(attempt);
      await sleep(delay);
      continue;
    }

    const failure: RequestFailure = { status: response.status, text: await response.text() };
    throw new SheetsHttpError(failure.status, `Sheets API request failed with ${failure.status}`, failure.text);
  }
}

function encodeRange(range: string): string {
  // encodeURIComponent handles "!" and every other A1-range-relevant char;
  // Sheets accepts the range as a single path segment.
  return encodeURIComponent(range);
}

function toCellGrid(values: unknown): CellGrid {
  if (!Array.isArray(values)) return [];
  return values.map((row): CellRow => (Array.isArray(row) ? (row as CellRow) : []));
}

/**
 * Creates one sheet tab via `batchUpdate`'s `addSheet` request. Exported (not
 * just used internally by `appendRows`'s own fallback below) so the
 * open-an-existing-workbook migration path (`migrate.ts`) can create several
 * missing tabs up front after listing what the spreadsheet already has,
 * rather than waiting for a write to fail first.
 *
 * Concurrency: two clients racing to fix the same stale workbook both call
 * this for the same sheet. Whichever request Google processes second gets a
 * 400 "already exists" - treated as success here, same as a retry of our own
 * previous attempt would be. Callers (both this file's `appendRows`/
 * `updateRange` fallbacks and `migrate.ts`) rely on that idempotency.
 */
export async function ensureSheetExists(
  spreadsheetId: string,
  sheetName: WorkbookSheetName,
  buildAuth: SheetsAuthAdapter,
  fetchImpl: typeof fetch,
): Promise<void> {
  const accessToken = await buildAuth.getAccessToken();
  const response = await fetchImpl(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
  });
  if (response.ok) return;
  const text = await response.text();
  // A concurrent creator (or a retry of our own previous attempt) may have
  // already added the tab - that is a success from our point of view.
  if (response.status === 400 && /already exists/i.test(text)) return;
  throw new SheetsHttpError(response.status, "Failed to create missing sheet tab", text);
}

/** True for the specific "range refers to a tab that doesn't exist yet" error Sheets returns on values.get/append/update/batchGet. */
function looksLikeMissingSheet(status: number, text: string): boolean {
  return status === 400 && /unable to parse range/i.test(text);
}

/**
 * Every range this codebase ever builds is `${sheetName}!...` (or, for
 * `appendRows`, a bare sheet name with no `!` at all) - never a sheet name
 * containing `!` itself (no `WorkbookSheetName` does). Splitting on the
 * first `!` therefore always recovers the real sheet name; the cast just
 * recovers the type this module's own string-based A1Range erased.
 */
function sheetNameOfRange(range: string): WorkbookSheetName {
  const bang = range.indexOf("!");
  return (bang === -1 ? range : range.slice(0, bang)) as WorkbookSheetName;
}

/**
 * Fetches one spreadsheet's current tab titles in a single round trip -
 * `fields=` restricts the response to just what's needed. Used by the
 * open-an-existing-workbook migration path (`migrate.ts`) to find out which
 * `WorkbookSheetName` tabs are missing before writing anything, rather than
 * discovering that one at a time via failed reads/writes.
 */
export async function listSheetTitles(
  spreadsheetId: string,
  options: Pick<CreateSheetsTransportOptions, "auth" | "fetchImpl" | "sleep" | "maxRetries">,
): Promise<readonly string[]> {
  const response = await requestWithRetry(
    (accessToken) =>
      new Request(`${SHEETS_API_BASE}/${spreadsheetId}?fields=sheets.properties.title`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    options,
  );
  const body = (await response.json()) as { sheets?: readonly { properties?: { title?: string } }[] };
  return (body.sheets ?? []).flatMap((sheet) => (sheet.properties?.title ? [sheet.properties.title] : []));
}

export function createGoogleSheetsTransport(options: CreateSheetsTransportOptions): SheetsTransport {
  const { spreadsheetId, auth } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  // Passed through as-is (not rebuilt as an object literal) so the optional
  // fields keep their `T | undefined` read type without tripping
  // exactOptionalPropertyTypes on a fresh literal.
  const retryOptions = options;

  async function readOnce(range: string): Promise<CellGrid> {
    const response = await requestWithRetry(
      (accessToken) =>
        new Request(
          `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeRange(range)}?valueRenderOption=UNFORMATTED_VALUE`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        ),
      retryOptions,
    );
    const body = (await response.json()) as { values?: unknown };
    return toCellGrid(body.values);
  }

  async function appendOnce(sheetName: WorkbookSheetName, rows: readonly CellRow[]) {
    return requestWithRetry(
      (accessToken) =>
        new Request(
          `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeRange(sheetName)}:append` +
            `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: rows }),
          },
        ),
      retryOptions,
    );
  }

  async function updateOnce(range: string, rows: readonly CellRow[]): Promise<void> {
    await requestWithRetry(
      (accessToken) =>
        new Request(`${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeRange(range)}?valueInputOption=RAW`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: rows }),
        }),
      retryOptions,
    );
  }

  /** Writes a sheet's header row (row 1) - shared by `appendRows`' and `updateRange`'s missing-tab fallbacks below. */
  async function writeHeader(sheetName: WorkbookSheetName): Promise<void> {
    const header = WORKBOOK_HEADERS[sheetName];
    const lastCol = columnLetter(header.length);
    await updateOnce(`${sheetName}!A1:${lastCol}1`, [header]);
  }

  /**
   * A tab that doesn't exist yet has no rows - the honest read result is
   * empty, not a crash. This is the fix for the production bug this module
   * exists to close: a workbook created before the current schema (missing,
   * say, `Products`) must not turn every read of that sheet into a hard
   * "Sheets API request failed with 400" error surfaced straight to the UI.
   * Reads deliberately do NOT create the tab (that would make a read a
   * hidden write) - see `migrate.ts` for the explicit, opt-in path that
   * brings a stale workbook's tabs up to date.
   */
  async function readOrEmpty(range: string): Promise<CellGrid> {
    try {
      return await readOnce(range);
    } catch (err) {
      if (err instanceof SheetsHttpError && looksLikeMissingSheet(err.status, err.body ?? "")) {
        return [];
      }
      throw err;
    }
  }

  return {
    async readRange(range) {
      return readOrEmpty(range);
    },

    async batchRead(ranges) {
      if (ranges.length === 0) return [];
      const query = ranges.map((range) => `ranges=${encodeRange(range)}`).join("&");
      try {
        const response = await requestWithRetry(
          (accessToken) =>
            new Request(
              `${SHEETS_API_BASE}/${spreadsheetId}/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&${query}`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            ),
          retryOptions,
        );
        const body = (await response.json()) as { valueRanges?: readonly { values?: unknown }[] };
        const valueRanges = body.valueRanges ?? [];
        return ranges.map((_, i) => toCellGrid(valueRanges[i]?.values));
      } catch (err) {
        if (err instanceof SheetsHttpError && looksLikeMissingSheet(err.status, err.body ?? "")) {
          // Unlike `appendRows`/`readRange`'s single range, `values:batchGet`
          // fails the ENTIRE request the moment any one of `ranges` names a
          // tab that doesn't exist yet - and the error names only the first
          // offending range, not every bad one, so there is no way to tell
          // from the response alone which of `ranges` are missing and which
          // are merely collateral damage. Falling back to `ranges.length`
          // independent reads - each already tolerant of its own tab being
          // missing via `readOrEmpty` above - is the only way to recover the
          // PRESENT ranges' real data without guessing: a range whose tab
          // exists must not come back empty just because a sibling range's
          // tab doesn't. This fallback only runs on the failure path, so a
          // healthy workbook (the common case) still costs exactly one round
          // trip, same as before.
          return Promise.all(ranges.map((range) => readOrEmpty(range)));
        }
        throw err;
      }
    },

    async appendRows(sheetName, rows) {
      let response: Response;
      try {
        response = await appendOnce(sheetName, rows);
      } catch (err) {
        if (err instanceof SheetsHttpError && looksLikeMissingSheet(err.status, err.body ?? "")) {
          await ensureSheetExists(spreadsheetId, sheetName, auth, fetchImpl);
          // Without this, a tab implicitly created by an append lands its
          // data rows at physical row 1 with no header at all - invariant 6
          // requires a header row on every sheet, and every reader in
          // workbook-store.ts assumes data starts at row 2. Write it before
          // retrying the append that triggered the creation in the first
          // place.
          await writeHeader(sheetName);
          response = await appendOnce(sheetName, rows);
        } else {
          throw err;
        }
      }
      const body = (await response.json()) as { updates?: { updatedRange?: string } };
      const updatedRange = body.updates?.updatedRange;
      if (!updatedRange) {
        throw new Error(`Sheets append response for ${sheetName} was missing updates.updatedRange.`);
      }
      return { updatedRange };
    },

    async updateRange(range, rows) {
      try {
        await updateOnce(range, rows);
      } catch (err) {
        if (err instanceof SheetsHttpError && looksLikeMissingSheet(err.status, err.body ?? "")) {
          // `bootstrapWorkbook`/`ensureHeader` (workbook-store.ts) both write
          // a sheet's header via `updateRange` - including onto a tab that
          // may not exist yet on a stale workbook (`ensureHeader` reads
          // first, via `readRange` above, which now tolerates a missing tab
          // and reports it as merely empty rather than throwing). Give
          // `updateRange` the same self-heal `appendRows` already has, or
          // every one of those header writes would still hard-fail here.
          await ensureSheetExists(spreadsheetId, sheetNameOfRange(range), auth, fetchImpl);
          await updateOnce(range, rows);
        } else {
          throw err;
        }
      }
    },
  };
}
