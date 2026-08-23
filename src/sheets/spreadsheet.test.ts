import { beforeEach, describe, expect, it } from "vitest";
import { createSpreadsheet, createWorkbook } from "./spreadsheet.ts";
import { createWorkbookRegistry } from "./registry.ts";
import { SheetsHttpError } from "./errors.ts";
import type { SheetsAuthAdapter } from "./transport.ts";

const AUTH: SheetsAuthAdapter = { getAccessToken: async () => "tok-abc", invalidate: () => {} };

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  localStorage.clear();
});

describe("createSpreadsheet", () => {
  it("POSTs to the bare spreadsheets endpoint with the title and all thirteen sheet tabs", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      () => jsonResponse({ spreadsheetId: "sheet-xyz", properties: { title: "Our Meal Planner" } }),
    ]);

    const result = await createSpreadsheet("Our Meal Planner", AUTH, { fetchImpl });

    expect(result).toEqual({ id: "sheet-xyz", name: "Our Meal Planner" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("https://sheets.googleapis.com/v4/spreadsheets");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer tok-abc");

    const body = JSON.parse(await requests[0]!.text()) as {
      properties: { title: string };
      sheets: Array<{ properties: { title: string } }>;
    };
    expect(body.properties.title).toBe("Our Meal Planner");
    expect(body.sheets.map((s) => s.properties.title)).toEqual([
      "Meta",
      "Settings",
      "Ingredients",
      "Recipes",
      "RecipeIngredients",
      "RecipeSteps",
      "PlanSlots",
      "InventoryEvents",
      "ShoppingItems",
      "Products",
      "ProductBarcodes",
      "Photos",
      "PriceObservations",
    ]);
  });

  it("throws SheetsHttpError when the API rejects the create request", async () => {
    const { fetchImpl } = scriptedFetch([() => jsonResponse({ error: "nope" }, 403)]);
    await expect(createSpreadsheet("Our Meal Planner", AUTH, { fetchImpl })).rejects.toBeInstanceOf(SheetsHttpError);
  });
});

describe("createWorkbook", () => {
  it("creates the spreadsheet and makes it the active workbook", async () => {
    const { fetchImpl } = scriptedFetch([
      () => jsonResponse({ spreadsheetId: "sheet-xyz", properties: { title: "Our Meal Planner" } }),
    ]);
    const registry = createWorkbookRegistry(localStorage, "feeder.workbookRegistry.spreadsheet-test");

    const created = await createWorkbook("Our Meal Planner", AUTH, registry, { fetchImpl });

    expect(created).toEqual({ id: "sheet-xyz", name: "Our Meal Planner" });
    expect(registry.getActive()).toEqual({ id: "sheet-xyz", name: "Our Meal Planner" });
    expect(registry.list()).toEqual([{ id: "sheet-xyz", name: "Our Meal Planner" }]);
  });
});
