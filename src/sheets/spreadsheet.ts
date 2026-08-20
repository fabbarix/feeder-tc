/**
 * Creates a brand-new Google Sheets spreadsheet with all nine WorkbookStore
 * tabs pre-created (DESIGN.md §3), and registers it in the workbook
 * registry as the active workbook. WP-11's bootstrap flow then writes each
 * tab's header row (and Meta's schema_version/generation) on top via
 * SheetsTransport.appendRows - it never needs to know how the spreadsheet
 * file itself came into being.
 *
 * Only ever called from an explicit "Create new meal planner" user action
 * (WP-20), after signIn() has already happened - never at import time.
 */
import type { WorkbookSheetName } from "../domain/types.ts";
import { SheetsHttpError } from "./errors.ts";
import type { SheetsAuthAdapter } from "./transport.ts";
import type { WorkbookRegistry, WorkbookRegistryEntry } from "./registry.ts";

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/** DESIGN.md §3, in the documented order. Kept in sync with WorkbookSheetName at compile time via `satisfies`. */
const WORKBOOK_SHEET_NAMES = [
  "Meta",
  "Settings",
  "Ingredients",
  "Recipes",
  "RecipeIngredients",
  "RecipeSteps",
  "PlanSlots",
  "InventoryEvents",
  "ShoppingItems",
] as const satisfies readonly WorkbookSheetName[];

export interface CreateSpreadsheetOptions {
  readonly fetchImpl?: typeof fetch;
}

/** Creates the spreadsheet file itself. Does not touch the workbook registry - see createWorkbook() for the full "create and activate" flow. */
export async function createSpreadsheet(
  title: string,
  auth: SheetsAuthAdapter,
  options?: CreateSpreadsheetOptions,
): Promise<WorkbookRegistryEntry> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const accessToken = await auth.getAccessToken();
  const response = await fetchImpl(SHEETS_API_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title },
      sheets: WORKBOOK_SHEET_NAMES.map((sheetTitle) => ({ properties: { title: sheetTitle } })),
    }),
  });
  if (!response.ok) {
    throw new SheetsHttpError(response.status, "Failed to create spreadsheet", await response.text());
  }
  const body = (await response.json()) as { spreadsheetId?: string; properties?: { title?: string } };
  if (!body.spreadsheetId) {
    throw new Error("Sheets API create response was missing spreadsheetId.");
  }
  return { id: body.spreadsheetId, name: body.properties?.title ?? title };
}

/** Creates a new spreadsheet and makes it the active workbook in one step - the "Create new meal planner" action. */
export async function createWorkbook(
  title: string,
  auth: SheetsAuthAdapter,
  registry: WorkbookRegistry,
  options?: CreateSpreadsheetOptions,
): Promise<WorkbookRegistryEntry> {
  const created = await createSpreadsheet(title, auth, options);
  registry.add(created);
  registry.setActive(created.id);
  return created;
}
