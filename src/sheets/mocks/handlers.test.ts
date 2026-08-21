import { describe, expect, it } from "vitest";
import { server } from "../../mocks/server.ts";
import { createSheetsApiHandlers } from "./handlers.ts";

const ACCESS_TOKEN = "handlers-test-token";

describe("createSheetsApiHandlers", () => {
  it("serves a plain GET values.get request over real fetch + msw", async () => {
    server.use(...createSheetsApiHandlers({ spreadsheetId: "handlers-sheet-1", accessToken: ACCESS_TOKEN }));

    const response = await fetch(
      "https://sheets.googleapis.com/v4/spreadsheets/handlers-sheet-1/values/InventoryEvents!A2:H?valueRenderOption=UNFORMATTED_VALUE",
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { values?: unknown };
    expect(body.values).toBeUndefined();
  });

  it("serves a scripted 429-then-200 failure sequence", async () => {
    server.use(
      ...createSheetsApiHandlers({
        spreadsheetId: "handlers-sheet-2",
        accessToken: ACCESS_TOKEN,
        failures: [{ status: 429, retryAfterSeconds: 1 }],
      }),
    );
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/handlers-sheet-2/values/InventoryEvents!A2:H?valueRenderOption=UNFORMATTED_VALUE";
    const headers = { Authorization: `Bearer ${ACCESS_TOKEN}` };

    const first = await fetch(url, { headers });
    expect(first.status).toBe(429);
    expect(first.headers.get("Retry-After")).toBe("1");

    const second = await fetch(url, { headers });
    expect(second.status).toBe(200);
  });

  // fix-missing-tabs: this double used to treat every WorkbookSheetName tab
  // as pre-created unconditionally ("All tabs are pre-created in this
  // double" — the comment that used to sit at the top of this file), which
  // meant no test anywhere could represent a workbook missing a tab. These
  // cases are the double's own contract for the new `existingSheets` option.
  describe("existingSheets", () => {
    it("a GET against a tab not in existingSheets gets the real API's 'Unable to parse range' 400 shape", async () => {
      server.use(
        ...createSheetsApiHandlers({
          spreadsheetId: "handlers-sheet-3",
          accessToken: ACCESS_TOKEN,
          existingSheets: ["Ingredients"],
        }),
      );

      const response = await fetch(
        "https://sheets.googleapis.com/v4/spreadsheets/handlers-sheet-3/values/Products!A2:F?valueRenderOption=UNFORMATTED_VALUE",
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: { message?: string } };
      expect(body.error?.message).toMatch(/unable to parse range/i);
    });

    it("values:batchGet fails the whole request when any one requested range's tab is missing", async () => {
      server.use(
        ...createSheetsApiHandlers({
          spreadsheetId: "handlers-sheet-4",
          accessToken: ACCESS_TOKEN,
          existingSheets: ["Ingredients"],
        }),
      );

      const response = await fetch(
        "https://sheets.googleapis.com/v4/spreadsheets/handlers-sheet-4/values:batchGet" +
          "?valueRenderOption=UNFORMATTED_VALUE&ranges=Ingredients!A1:A&ranges=Products!A1:A",
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
      );

      expect(response.status).toBe(400);
    });

    it("an addSheet batchUpdate admits the tab, after which reads/appends against it succeed", async () => {
      server.use(
        ...createSheetsApiHandlers({
          spreadsheetId: "handlers-sheet-5",
          accessToken: ACCESS_TOKEN,
          existingSheets: [],
        }),
      );
      const base = "https://sheets.googleapis.com/v4/spreadsheets/handlers-sheet-5";
      const headers = { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" };

      const addSheet = await fetch(`${base}:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "Products" } } }] }),
      });
      expect(addSheet.status).toBe(200);

      const read = await fetch(`${base}/values/Products!A1:F?valueRenderOption=UNFORMATTED_VALUE`, { headers });
      expect(read.status).toBe(200);

      // A second, concurrent creator gets "already exists" - still a 400,
      // but real transport's ensureSheetExists treats this shape as success.
      const raceAddSheet = await fetch(`${base}:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "Products" } } }] }),
      });
      expect(raceAddSheet.status).toBe(400);
      const raceBody = (await raceAddSheet.json()) as { error?: { message?: string } };
      expect(raceBody.error?.message).toMatch(/already exists/i);
    });

    it("spreadsheets.get (fields=sheets.properties.title) reports exactly existingSheets - listSheetTitles' request", async () => {
      server.use(
        ...createSheetsApiHandlers({
          spreadsheetId: "handlers-sheet-6",
          accessToken: ACCESS_TOKEN,
          existingSheets: ["Meta", "Settings"],
        }),
      );

      const response = await fetch(
        "https://sheets.googleapis.com/v4/spreadsheets/handlers-sheet-6?fields=sheets.properties.title",
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { sheets?: readonly { properties?: { title?: string } }[] };
      const titles = (body.sheets ?? []).map((s) => s.properties?.title).sort();
      expect(titles).toEqual(["Meta", "Settings"]);
    });

    it("omitting existingSheets keeps the original 'every tab pre-created' behaviour", async () => {
      server.use(...createSheetsApiHandlers({ spreadsheetId: "handlers-sheet-7", accessToken: ACCESS_TOKEN }));

      const response = await fetch(
        "https://sheets.googleapis.com/v4/spreadsheets/handlers-sheet-7/values/Products!A2:F?valueRenderOption=UNFORMATTED_VALUE",
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
      );

      expect(response.status).toBe(200);
    });
  });
});
