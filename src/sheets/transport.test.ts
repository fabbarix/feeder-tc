import { describe, expect, it, vi } from "vitest";
import { createGoogleSheetsTransport, type SheetsAuthAdapter } from "./transport.ts";
import { columnLetter, WORKBOOK_HEADERS } from "./codecs/index.ts";
import { ReAuthRequiredError, SheetsHttpError } from "./errors.ts";

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

function scriptedFetch(factories: Array<() => Response>): { fetchImpl: typeof fetch; requests: Request[] } {
  const requests: Request[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    requests.push(req);
    const factory = factories[i];
    i += 1;
    if (!factory) throw new Error("scriptedFetch: ran out of scripted responses");
    return factory();
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function fixedTokenAuth(token: string, onInvalidate?: () => void): SheetsAuthAdapter {
  return {
    getAccessToken: async () => token,
    invalidate: () => onInvalidate?.(),
  };
}

function refreshingAuth(tokens: readonly string[]): SheetsAuthAdapter {
  let index = 0;
  return {
    getAccessToken: async () => {
      const token = tokens[index];
      if (token === undefined) throw new ReAuthRequiredError();
      return token;
    },
    invalidate: () => {
      index += 1;
    },
  };
}

describe("createGoogleSheetsTransport", () => {
  it("sends only an Authorization bearer header - never an API key query param", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      () => jsonResponse({ range: "Ingredients!A2:E", values: undefined }),
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async () => {},
    });

    await transport.readRange("Ingredients!A2:E");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer tok-abc");
    expect(new URL(requests[0]!.url).searchParams.has("key")).toBe(false);
  });

  it("retries a 429 using the Retry-After header, then succeeds", async () => {
    const sleepCalls: number[] = [];
    const { fetchImpl } = scriptedFetch([
      () => jsonResponse({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "2" } }),
      () => jsonResponse({ range: "InventoryEvents!A2:H", values: [["evt-1", "purchase"]] }),
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    const rows = await transport.readRange("InventoryEvents!A2:H");

    expect(rows).toEqual([["evt-1", "purchase"]]);
    expect(sleepCalls).toEqual([2000]); // Retry-After: 2 seconds, honored verbatim
  });

  it("retries a 500 with exponential backoff (no Retry-After present)", async () => {
    const sleepCalls: number[] = [];
    const { fetchImpl } = scriptedFetch([
      () => jsonResponse({ error: "boom" }, { status: 500 }),
      () => jsonResponse({ range: "Ingredients!A2:E", values: [] }),
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    await transport.readRange("Ingredients!A2:E");
    expect(sleepCalls).toHaveLength(1);
    expect(sleepCalls[0]).toBeGreaterThan(0);
  });

  it("gives up after exhausting retries on a persistent 429 and throws SheetsHttpError", async () => {
    const { fetchImpl } = scriptedFetch([
      () => jsonResponse({}, { status: 429 }),
      () => jsonResponse({}, { status: 429 }),
      () => jsonResponse({}, { status: 429 }),
      () => jsonResponse({}, { status: 429 }),
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async () => {},
      maxRetries: 3,
    });

    await expect(transport.readRange("Ingredients!A2:E")).rejects.toBeInstanceOf(SheetsHttpError);
  });

  it("on 401, invalidates the token and retries once with a freshly-fetched one", async () => {
    const auth = refreshingAuth(["stale-tok", "fresh-tok"]);
    const { fetchImpl, requests } = scriptedFetch([
      () => jsonResponse({ error: "Invalid Credentials" }, { status: 401 }),
      () => jsonResponse({ range: "Ingredients!A2:E", values: [] }),
    ]);
    const transport = createGoogleSheetsTransport({ spreadsheetId: "sheet-1", auth, fetchImpl, sleep: async () => {} });

    await transport.readRange("Ingredients!A2:E");

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer stale-tok");
    expect(requests[1]?.headers.get("authorization")).toBe("Bearer fresh-tok");
  });

  it("throws ReAuthRequiredError, not a generic SheetsHttpError, when 401s persist through the retry budget", async () => {
    const invalidate = vi.fn();
    const { fetchImpl } = scriptedFetch([
      () => jsonResponse({}, { status: 401 }),
      () => jsonResponse({}, { status: 401 }),
      () => jsonResponse({}, { status: 401 }),
      () => jsonResponse({}, { status: 401 }),
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc", invalidate),
      fetchImpl,
      sleep: async () => {},
      maxRetries: 3,
    });

    await expect(transport.readRange("Ingredients!A2:E")).rejects.toBeInstanceOf(ReAuthRequiredError);
    expect(invalidate).toHaveBeenCalled();
  });

  it("appendRows: when the target sheet tab does not exist yet, creates it, writes its header row, then retries the append once", async () => {
    // REGRESSION (fix-missing-tabs): before this fix, a tab created
    // implicitly by an append got no header row at all - its data rows
    // landed at physical row 1, which every reader in workbook-store.ts
    // treats as the header (invariant 6: header row on every sheet).
    const header = WORKBOOK_HEADERS.Ingredients;
    const lastCol = columnLetter(header.length);
    const { fetchImpl, requests } = scriptedFetch([
      () => jsonResponse({ error: { message: "Unable to parse range: Ingredients!A1" } }, { status: 400 }),
      () => jsonResponse({ replies: [{}] }), // batchUpdate addSheet
      () => jsonResponse({ updatedRange: `Ingredients!A1:${lastCol}1` }), // header PUT
      () => jsonResponse({ updates: { updatedRange: "Ingredients!A2:B2" } }), // retried append
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async () => {},
    });

    const result = await transport.appendRows("Ingredients", [["ing-1", "Rice"]]);

    expect(result.updatedRange).toBe("Ingredients!A2:B2");
    expect(requests).toHaveLength(4);
    expect(requests[1]?.url).toContain(":batchUpdate");
    expect(requests[1]?.method).toBe("POST");
    expect(requests[2]?.method).toBe("PUT");
    expect(requests[2]?.url).toContain(encodeURIComponent(`Ingredients!A1:${lastCol}1`));
    expect(await requests[2]?.json()).toEqual({ values: [header] });
    expect(requests[3]?.method).toBe("POST");
    expect(requests[3]?.url).toContain(":append");
  });

  it("updateRange sends the rows to the exact requested range via PUT", async () => {
    const { fetchImpl, requests } = scriptedFetch([() => jsonResponse({ updatedRange: "Recipes!A1:C1" })]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async () => {},
    });

    await transport.updateRange("Recipes!A1:C1", [["rec-1", "Chili con carne", "cooked"]]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("PUT");
    expect(requests[0]?.url).toContain(encodeURIComponent("Recipes!A1:C1"));
  });

  it("updateRange: when the target sheet tab does not exist yet, creates it via batchUpdate then retries the PUT once", async () => {
    // REGRESSION (fix-missing-tabs): bootstrapWorkbook and workbook-store.ts's
    // ensureHeader both write a header via updateRange, including onto a tab
    // that may not exist yet on a stale (pre-current-schema) workbook.
    const { fetchImpl, requests } = scriptedFetch([
      () => jsonResponse({ error: { message: "Unable to parse range: Products!A1:F1" } }, { status: 400 }),
      () => jsonResponse({ replies: [{}] }), // batchUpdate addSheet
      () => jsonResponse({ updatedRange: "Products!A1:F1" }), // retried PUT
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async () => {},
    });

    await transport.updateRange("Products!A1:F1", [["barcode", "name"]]);

    expect(requests).toHaveLength(3);
    expect(requests[1]?.url).toContain(":batchUpdate");
    expect(requests[2]?.method).toBe("PUT");
  });

  it("readRange returns an empty grid, not a thrown error, when the target sheet tab does not exist yet", async () => {
    // REGRESSION (fix-missing-tabs): this is the production bug itself - the
    // scan route's `store.products.readAll()` calling `readRange` on a
    // workbook created before `Products` existed used to surface a raw
    // "Sheets API request failed with 400" straight to the UI. A tab that
    // doesn't exist has no rows; the honest read result is empty, not a
    // crash.
    const { fetchImpl } = scriptedFetch([
      () => jsonResponse({ error: { message: "Unable to parse range: Products!A2:F" } }, { status: 400 }),
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async () => {},
    });

    await expect(transport.readRange("Products!A2:F")).resolves.toEqual([]);
  });

  it("readRange still throws SheetsHttpError for a 400 that is NOT the missing-tab shape", async () => {
    // The missing-tab tolerance must not swallow every 400 - only the
    // specific "unable to parse range" one Sheets returns for a tab that
    // isn't there.
    const { fetchImpl } = scriptedFetch([
      () => jsonResponse({ error: { message: "Invalid range specified" } }, { status: 400 }),
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async () => {},
    });

    await expect(transport.readRange("Products!A2:F")).rejects.toBeInstanceOf(SheetsHttpError);
  });

  it("batchRead requests every range in one call and returns grids in the same order", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      () =>
        jsonResponse({
          valueRanges: [{ range: "Meta!A1:B1", values: [["1", "1"]] }, { range: "Settings!A1:A1", values: [["4"]] }],
        }),
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async () => {},
    });

    const [metaRows, settingsRows] = await transport.batchRead(["Meta!A1:B1", "Settings!A1:A1"]);

    expect(metaRows).toEqual([["1", "1"]]);
    expect(settingsRows).toEqual([["4"]]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("values:batchGet");
  });

  it("batchRead falls back to independent per-range reads when the batch fails because one range's tab is missing, so present ranges are not blanked", async () => {
    // REGRESSION (fix-missing-tabs) / design decision: unlike a single
    // readRange/append, values:batchGet fails the ENTIRE request the moment
    // ANY one of the requested ranges names a tab that doesn't exist yet -
    // and the error names only the first offending range, so there is no way
    // to tell from the response alone which ranges are missing versus merely
    // collateral damage. The fix falls back to one independent read per
    // range (each itself tolerant of a missing tab) rather than guessing, so
    // a present range's real data is never blanked out by an absent sibling.
    const requestUrls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      requestUrls.push(req.url);
      const url = new URL(req.url);
      if (url.pathname.endsWith(":batchGet")) {
        return jsonResponse({ error: { message: "Unable to parse range: Missing!A1:A" } }, { status: 400 });
      }
      const encodedRange = url.pathname.slice(url.pathname.indexOf("/values/") + "/values/".length);
      const range = decodeURIComponent(encodedRange);
      if (range === "Missing!A1:A") {
        return jsonResponse({ error: { message: "Unable to parse range: Missing!A1:A" } }, { status: 400 });
      }
      if (range === "Present!A1:A") {
        return jsonResponse({ range, values: [["ok"]] });
      }
      throw new Error(`unexpected request: ${req.url}`);
    }) as typeof fetch;

    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async () => {},
    });

    const [presentRows, missingRows] = await transport.batchRead(["Present!A1:A", "Missing!A1:A"]);

    expect(presentRows).toEqual([["ok"]]);
    expect(missingRows).toEqual([]);
    expect(requestUrls.filter((u) => u.includes(":batchGet"))).toHaveLength(1);
    // Exactly one individual GET per range in the fallback - present's tab
    // is read once (successfully), not silently skipped or re-requested.
    const individualGets = requestUrls.filter((u) => u.includes("/values/") && !u.includes(":batchGet"));
    expect(individualGets).toHaveLength(2);
    expect(individualGets.some((u) => u.includes(encodeURIComponent("Present!A1:A")))).toBe(true);
    expect(individualGets.some((u) => u.includes(encodeURIComponent("Missing!A1:A")))).toBe(true);
  });
});
