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
 * Every sheet tab is treated as already existing, matching production: the
 * workbook-creation flow (spreadsheet.ts) creates every WorkbookSheetName
 * tabs up front, so by the time any read/append/update happens the tab is
 * already there. transport.test.ts covers the "tab genuinely missing"
 * fallback (values.append 400 -> batchUpdate addSheet -> retry) separately,
 * with its own bespoke one-off handlers.
 */
import { http, HttpResponse, type HttpHandler } from "msw";
import { createFakeSheetsTransport } from "../../domain/fakes/index.ts";
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
    http.get(`${base}/*`, async ({ request }) => {
      const failure = checkRequest(request);
      if (failure) return failure;
      const suffix = suffixOf(request);

      if (suffix === "/values:batchGet") {
        const ranges = new URL(request.url).searchParams.getAll("ranges");
        const grids = await fake.batchRead(ranges);
        return HttpResponse.json({
          spreadsheetId: options.spreadsheetId,
          valueRanges: grids.map((values, i) => ({ range: ranges[i], values: values.length > 0 ? values : undefined })),
        });
      }
      if (suffix.startsWith("/values/")) {
        const range = decodeURIComponent(suffix.slice("/values/".length));
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
      // All tabs are pre-created in this double; addSheet is a no-op success.
      // (Deliberately not a hardcoded count — it was "nine" until M6-A added
      // Products/ProductPhotos/PriceObservations, and went stale silently.)
      return HttpResponse.json({ spreadsheetId: options.spreadsheetId, replies: [{}] });
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
