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

async function ensureSheetExists(
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

/** True for the specific "range refers to a tab that doesn't exist yet" error Sheets returns on values.append. */
function looksLikeMissingSheet(status: number, text: string): boolean {
  return status === 400 && /unable to parse range/i.test(text);
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

  return {
    async readRange(range) {
      return readOnce(range);
    },

    async batchRead(ranges) {
      const query = ranges.map((range) => `ranges=${encodeRange(range)}`).join("&");
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
    },

    async appendRows(sheetName, rows) {
      let response: Response;
      try {
        response = await appendOnce(sheetName, rows);
      } catch (err) {
        if (err instanceof SheetsHttpError && looksLikeMissingSheet(err.status, err.body ?? "")) {
          await ensureSheetExists(spreadsheetId, sheetName, auth, fetchImpl);
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
      await requestWithRetry(
        (accessToken) =>
          new Request(`${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeRange(range)}?valueInputOption=RAW`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: rows }),
          }),
        retryOptions,
      );
    },
  };
}
