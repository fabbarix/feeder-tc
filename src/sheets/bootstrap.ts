/**
 * Create-workbook flow, second half (WP-11). WP-10's `createSpreadsheet`/
 * `createWorkbook` (spreadsheet.ts) creates the file with all nine
 * `WorkbookSheetName` tabs already present, but empty. This module writes
 * what those tabs need to actually be a workbook per DESIGN.md §3: the
 * header row on every sheet, the schema-version/generation stamp in Meta,
 * sensible Settings defaults, and the seeded ingredient catalog (WP-16) —
 * the BDD scenario "Creating a fresh workbook"
 * (features/wp-11-workbook-bootstrap.feature).
 */
import { seedCatalog } from "../data/seed-catalog.ts";
import type { SheetsTransport, WorkbookStore } from "../domain/contracts.ts";
import type { Settings, WorkbookSheetName } from "../domain/types.ts";
import { columnLetter, DEFAULT_CURRENCY, SCHEMA_VERSION, WORKBOOK_HEADERS } from "./codecs/index.ts";

/**
 * DESIGN.md §3, in the documented order. Deliberately independent of
 * spreadsheet.ts's own (private) list of the same nine names — WP-11 does
 * not reach into WP-10's module internals for this.
 */
export const WORKBOOK_SHEET_NAMES: readonly WorkbookSheetName[] = [
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
  "ProductPhotos",
  "PriceObservations",
];

export const INITIAL_GENERATION = 1;

/**
 * A reasonable starting layout an onboarding household can edit later
 * (WP-22's Settings UI) — no BDD scenario asserts particular values here,
 * just a sane default so day one isn't an empty planner.
 */
export const DEFAULT_SETTINGS: Settings = {
  householdSize: 2,
  slotLayout: [
    { day: "monday", slots: ["breakfast", "lunch", "dinner"] },
    { day: "tuesday", slots: ["breakfast", "lunch", "dinner"] },
    { day: "wednesday", slots: ["breakfast", "lunch", "dinner"] },
    { day: "thursday", slots: ["breakfast", "lunch", "dinner"] },
    { day: "friday", slots: ["breakfast", "lunch", "dinner"] },
    { day: "saturday", slots: ["breakfast", "lunch", "dinner"] },
    { day: "sunday", slots: ["breakfast", "lunch", "dinner"] },
  ],
  repeatExclusionWeeks: 3,
  currency: DEFAULT_CURRENCY,
};

/**
 * Writes every sheet's header row, stamps Meta (`schema_version` 1,
 * `generation` 1), writes default Settings, and seeds the ingredient
 * catalog.
 *
 * Ingredients are upserted one at a time, in sequence (never
 * `Promise.all`'d): `WorkbookStore.ingredients.upsert` is a read-then-write
 * with no locking (by design — HANDOVER.md §3 "Concurrency"), so concurrent
 * upserts against the same freshly-created sheet would race and could
 * duplicate rows. Bootstrap is a one-time onboarding action, not a hot
 * path, so the sequential round trips are an acceptable trade for
 * correctness. Idempotent: re-running against an already-bootstrapped
 * workbook just replaces each row in place (`upsert` is insert-or-replace
 * by id, and seed-catalog.ts's ids are fixed slugs, never re-minted — see
 * that file's header comment).
 */
export async function bootstrapWorkbook(transport: SheetsTransport, store: WorkbookStore): Promise<void> {
  for (const sheet of WORKBOOK_SHEET_NAMES) {
    const header = WORKBOOK_HEADERS[sheet];
    const lastCol = columnLetter(header.length);
    await transport.updateRange(`${sheet}!A1:${lastCol}1`, [header]);
  }

  await store.meta.write({ schemaVersion: SCHEMA_VERSION, generation: INITIAL_GENERATION });
  await store.settings.write(DEFAULT_SETTINGS);

  for (const ingredient of seedCatalog) {
    await store.ingredients.upsert(ingredient);
  }
}
