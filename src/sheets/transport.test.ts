import { describe, expect, it, vi } from "vitest";
import { createGoogleSheetsTransport, type SheetsAuthAdapter } from "./transport.ts";
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

  it("appendRows: when the target sheet tab does not exist yet, creates it via batchUpdate then retries the append once", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      () => jsonResponse({ error: { message: "Unable to parse range: NewSheet!A1" } }, { status: 400 }),
      () => jsonResponse({ replies: [{}] }), // batchUpdate addSheet
      () => jsonResponse({ updates: { updatedRange: "NewSheet!A1:B1" } }), // retried append
    ]);
    const transport = createGoogleSheetsTransport({
      spreadsheetId: "sheet-1",
      auth: fixedTokenAuth("tok-abc"),
      fetchImpl,
      sleep: async () => {},
    });

    const result = await transport.appendRows("Ingredients", [["ing-1", "Rice"]]);

    expect(result.updatedRange).toBe("NewSheet!A1:B1");
    expect(requests).toHaveLength(3);
    expect(requests[1]?.url).toContain(":batchUpdate");
    expect(requests[1]?.method).toBe("POST");
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
});
