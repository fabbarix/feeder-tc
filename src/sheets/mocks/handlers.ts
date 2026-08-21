/**
 * A minimal in-process double for the Google Sheets REST API v4, used by
 * WP-10's own tests (transport.contract.test.ts, transport.test.ts,
 * features/wp-10-*.steps.ts) via msw. Not wired into the shared
 * src/mocks/handlers.ts array - WP-10's tests register these per-test with
 * `server.use(...)` against a fresh, unique spreadsheetId, since the
 * SheetsTransport contract suite expects `makeSubject()` to hand back an
 * isolated, empty subject every time it is called.
 *
 * Backed by the exact same in-memory grid as the domain's
 * createFakeSheetsTransport, so the A1-range semantics this double exhibits
 * are identical to what WP-10's real transport is contractually required to
 * reproduce - this file only adds the HTTP shape (auth header, status
 * codes, Retry-After, JSON envelopes) on top.
 *
 * By default every `WorkbookSheetName` tab is treated as already existing,
 * matching production immediately after workbook creation (spreadsheet.ts
 * creates all twelve tabs up front) - and matching every caller of this
 * double that predates the fix-missing-tabs work. Pass `existingSheets` to
 * model a workbook created before the current schema instead: a read
 * against, append to, or header-write onto a tab NOT in that list gets the
 * exact "Unable to parse range" 400 shape the real API returns for a tab
 * that doesn't exist yet, and only an `addSheet` batchUpdate request (real
 * transport's `ensureSheetExists`, or `migrate.ts`'s `ensureWorkbookSchema`)
 * admits a name to the set from then on - this is what makes it possible to
 * write a test at all for "read of a missing tab", "batchRead with one
 * missing range among present ones", "opening a stale workbook migrates
 * it", and "two clients race to create the same missing tab": before this,
 * "all tabs are pre-created in this double" meant no test anywhere could
 * represent the bug this whole fix closes.
 */
import { http, HttpResponse, type HttpHandler } from "msw";
import { createFakeSheetsTransport } from "../../domain/fakes/index.ts";
import { WORKBOOK_SHEET_NAMES } from "../bootstrap.ts";
import type { WorkbookSheetName } from "../../domain/types.ts";

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export interface SimulatedFailure {
  readonly status: number;
  readonly retryAfterSeconds?: number;
}

export interface MockSheetsSpreadsheetOptions {
  readonly spreadsheetId: string;
  /** Every request must carry exactly this bearer token; anything else (including none) yields a 401. */
  readonly accessToken: string;
  /** Consumed in order, one per request that would otherwise succeed - lets tests script "429 then 200" etc. */
  readonly failures?: readonly SimulatedFailure[];
  /**
   * Which `WorkbookSheetName` tabs already exist on this simulated
   * spreadsheet. Omitted (the default) means all twelve - see this module's
   * header comment. Pass a narrower list (even `[]`, a workbook with none of
   * the current schema's tabs) to model a stale workbook.
   */
  readonly existingSheets?: readonly WorkbookSheetName[];
}

/** Sheets' own error shape for "this range names a tab that doesn't exist" - matches `looksLikeMissingSheet` in transport.ts. */
function missingSheetError(range: string) {
  return HttpResponse.json({ error: { code: 400, message: `Unable to parse range: ${range}` } }, { status: 400 });
}

/** The part of an A1 range (or a bare sheet name, as `values.append`'s URL uses) before the first `!`, if any. */
function sheetNameOfRange(range: string): string {
  const bang = range.indexOf("!");
  return bang === -1 ? range : range.slice(0, bang);
}

function unauthorized() {
  return HttpResponse.json({ error: { code: 401, message: "Invalid Credentials" } }, { status: 401 });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function apiKeyRejected() {
  // Invariant check surfaced as an HTTP-shaped failure: if the Picker key
  // ever leaked onto a Sheets call, this double refuses it the same way the
  // real, referrer/API-restricted key would.
  return HttpResponse.json(
    { error: { code: 400, message: "API keys are not accepted for Sheets API requests." } },
    { status: 400 },
  );
}

export function createSheetsApiHandlers(options: MockSheetsSpreadsheetOptions): HttpHandler[] {
  const fake = createFakeSheetsTransport();
  const remainingFailures = [...(options.failures ?? [])];
  const base = `${SHEETS_API_BASE}/${options.spreadsheetId}`;
  const basePathname = new URL(base).pathname;
  // Mutated by the batchUpdate/addSheet handler below as tabs get created -
  // see this module's header comment for what an omitted `existingSheets`
  // (every tab present, unrestricted) versus an explicit list means.
  const sheets = new Set<string>(options.existingSheets ?? WORKBOOK_SHEET_NAMES);

  function checkRequest(request: Request) {
    if (request.headers.get("authorization") !== `Bearer ${options.accessToken}`) {
      return unauthorized();
    }
    if (new URL(request.url).searchParams.has("key")) {
      return apiKeyRejected();
    }
    const next = remainingFailures.shift();
    if (next) {
      const init: { status: number; headers?: Record<string, string> } = { status: next.status };
      if (next.retryAfterSeconds !== undefined) {
        init.headers = { "Retry-After": String(next.retryAfterSeconds) };
      }
      return HttpResponse.json({ error: { code: next.status, message: "Simulated failure" } }, init);
    }
    return undefined;
  }

  function suffixOf(request: Request): string {
    return new URL(request.url).pathname.slice(basePathname.length);
  }

  return [
    // Exact-match (no trailing path segment) - `spreadsheets.get`, restricted
    // via `fields=` to just the tab list. This is `listSheetTitles`'s
    // (transport.ts) only request, used by the open-an-existing-workbook
    // migration path (`migrate.ts`) to find out what's missing before
    // writing anything.
    http.get(base, async ({ request }) => {
      const failure = checkRequest(request);
      if (failure) return failure;
      return HttpResponse.json({
        spreadsheetId: options.spreadsheetId,
        sheets: [...sheets].map((title) => ({ properties: { title } })),
      });
    }),

    http.get(`${base}/*`, async ({ request }) => {
      const failure = checkRequest(request);
      if (failure) return failure;
      const suffix = suffixOf(request);

      if (suffix === "/values:batchGet") {
        const ranges = new URL(request.url).searchParams.getAll("ranges");
        // Real batchGet fails the WHOLE request the moment any one range
        // names a tab that isn't there, naming only that first offending
        // range - see transport.ts's batchRead fallback, the behaviour this
        // exists to let a test exercise.
        const missingRange = ranges.find((range) => !sheets.has(sheetNameOfRange(range)));
        if (missingRange) return missingSheetError(missingRange);
        const grids = await fake.batchRead(ranges);
        return HttpResponse.json({
          spreadsheetId: options.spreadsheetId,
          valueRanges: grids.map((values, i) => ({ range: ranges[i], values: values.length > 0 ? values : undefined })),
        });
      }
      if (suffix.startsWith("/values/")) {
        const range = decodeURIComponent(suffix.slice("/values/".length));
        if (!sheets.has(sheetNameOfRange(range))) return missingSheetError(range);
        const values = await fake.readRange(range);
        return HttpResponse.json({ range, majorDimension: "ROWS", values: values.length > 0 ? values : undefined });
      }
      return HttpResponse.json({ error: { code: 404, message: `Unhandled mock GET ${suffix}` } }, { status: 404 });
    }),

    // Sheets' :batchUpdate RPC path has NO slash before the colon
    // ("{base}:batchUpdate"), unlike every other operation below - it needs
    // its own exact-match handler rather than living inside the `${base}/*`
    // wildcard, which only matches paths starting with an actual "/". A
    // RegExp predicate (tested against the full request URL) sidesteps any
    // ambiguity in how a string pattern's literal ":" would otherwise be
    // parsed as a path-to-regexp named-parameter delimiter.
    http.post(new RegExp(`^${escapeRegExp(base)}:batchUpdate$`), async ({ request }) => {
      const failure = checkRequest(request);
      if (failure) return failure;
      const body = (await request.json()) as {
        requests?: readonly { addSheet?: { properties?: { title?: string } } }[];
      };
      const titles = (body.requests ?? []).flatMap((r) => (r.addSheet?.properties?.title ? [r.addSheet.properties.title] : []));
      // Mirrors the real API's addSheet rejection for a duplicate title -
      // ensureSheetExists (transport.ts) treats this specific shape as
      // success (a concurrent creator, or a retry of our own previous
      // attempt, already added it), which is exactly what the
      // concurrent-creation scenario exercises.
      const alreadyExists = titles.find((title) => sheets.has(title));
      if (alreadyExists) {
        return HttpResponse.json(
          {
            error: {
              code: 400,
              message: `A sheet with the name "${alreadyExists}" already exists. Please enter another name.`,
            },
          },
          { status: 400 },
        );
      }
      for (const title of titles) sheets.add(title);
      return HttpResponse.json({ spreadsheetId: options.spreadsheetId, replies: titles.map(() => ({})) });
    }),

    http.post(`${base}/*`, async ({ request }) => {
      const failure = checkRequest(request);
      if (failure) return failure;
      const suffix = suffixOf(request);

      if (suffix.startsWith("/values/") && suffix.endsWith(":append")) {
        // Runtime value always originates from transport.ts, which only ever
        // sends a real WorkbookSheetName - this cast just recovers the type
        // this mock's own generic string-keyed URL parsing erased.
        const sheetName = decodeURIComponent(
          suffix.slice("/values/".length, -":append".length),
        ) as WorkbookSheetName;
        if (!sheets.has(sheetName)) return missingSheetError(sheetName);
        const body = (await request.json()) as { values?: unknown };
        const rows = Array.isArray(body.values) ? body.values : [];
        const result = await fake.appendRows(sheetName, rows);
        return HttpResponse.json({
          spreadsheetId: options.spreadsheetId,
          updates: { updatedRange: result.updatedRange, updatedRows: rows.length },
        });
      }
      return HttpResponse.json({ error: { code: 404, message: `Unhandled mock POST ${suffix}` } }, { status: 404 });
    }),

    http.put(`${base}/*`, async ({ request }) => {
      const failure = checkRequest(request);
      if (failure) return failure;
      const suffix = suffixOf(request);

      if (suffix.startsWith("/values/")) {
        const range = decodeURIComponent(suffix.slice("/values/".length));
        if (!sheets.has(sheetNameOfRange(range))) return missingSheetError(range);
        const body = (await request.json()) as { values?: unknown };
        const rows = Array.isArray(body.values) ? body.values : [];
        await fake.updateRange(range, rows);
        return HttpResponse.json({ spreadsheetId: options.spreadsheetId, updatedRange: range });
      }
      return HttpResponse.json({ error: { code: 404, message: `Unhandled mock PUT ${suffix}` } }, { status: 404 });
    }),
  ];
}

/** Handler for POST https://sheets.googleapis.com/v4/spreadsheets (create a brand-new spreadsheet) - spreadsheet.ts's mock. */
export function createSpreadsheetCreationHandler(
  accessToken: string,
  respond: (title: string) => { spreadsheetId: string; title: string },
): HttpHandler {
  return http.post(SHEETS_API_BASE, async ({ request }) => {
    if (request.headers.get("authorization") !== `Bearer ${accessToken}`) return unauthorized();
    if (new URL(request.url).searchParams.has("key")) return apiKeyRejected();
    const body = (await request.json()) as { properties?: { title?: string } };
    const title = body.properties?.title ?? "Untitled";
    const { spreadsheetId, title: finalTitle } = respond(title);
    return HttpResponse.json({ spreadsheetId, properties: { title: finalTitle } });
  });
}
