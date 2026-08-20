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
});
