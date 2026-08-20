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
import type { CellRow, SheetsTransport, WorkbookStore } from "../domain/contracts.ts";
import type { Settings, WorkbookSheetName } from "../domain/types.ts";
import {
  columnLetter,
  decodeIngredient,
  DEFAULT_CURRENCY,
  encodeIngredient,
  INGREDIENTS_HEADER,
  isBlankRow,
  SCHEMA_VERSION,
  WORKBOOK_HEADERS,
} from "./codecs/index.ts";

/**
 * DESIGN.md §3 plus DESIGN_PRODUCTS.md §2, in the documented order.
 * Deliberately independent of spreadsheet.ts's own (private) list of the
 * same twelve names — WP-11 does not reach into WP-10's module internals
 * for this. (Was "nine" until M6-A added Products/ProductPhotos/
 * PriceObservations; the count is easy to leave stale, so if you add a
 * sheet, grep for "nine"/"twelve" across the repo.)
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
 * Idempotent: re-running against an already-bootstrapped workbook replaces
 * each matching ingredient row in place rather than duplicating it
 * (seed-catalog.ts's ids are fixed slugs, never re-minted — see that
 * file's header comment) — see `seedIngredients` below for how.
 */
export async function bootstrapWorkbook(transport: SheetsTransport, store: WorkbookStore): Promise<void> {
  for (const sheet of WORKBOOK_SHEET_NAMES) {
    const header = WORKBOOK_HEADERS[sheet];
    const lastCol = columnLetter(header.length);
    await transport.updateRange(`${sheet}!A1:${lastCol}1`, [header]);
  }

  await store.meta.write({ schemaVersion: SCHEMA_VERSION, generation: INITIAL_GENERATION });
  await store.settings.write(DEFAULT_SETTINGS);

  await seedIngredients(transport);
}

/**
 * Seeds the ~100-row catalog in a bounded number of Sheets API calls,
 * rather than one `WorkbookStore.ingredients.upsert` (itself a read + a
 * write, since it has no way to know the sheet's current contents up
 * front) per ingredient. That was the original implementation here —
 * correct, but ~300 sequential requests to seed the full catalog is enough
 * to trip the real Sheets API's per-user rate limit on a live account
 * (owner-reported: HTTP 429 during "Create new meal planner"). `transport
 * .ts` already retries an individual 429 with backoff, but retrying ~300
 * separately-throttled requests is a bad first-run experience, not merely
 * a slow one — the fix is to not make ~300 requests in the first place.
 *
 * One read of the whole Ingredients sheet (empty, on a fresh workbook),
 * then ONE `appendRows` call carrying every catalog entry that doesn't
 * already exist there — the common case is ALL of them, on a brand-new
 * workbook, so bootstrap now makes ~2 Ingredients requests total instead
 * of ~300. Re-running against an already-seeded workbook still replaces a
 * MATCHING row in place with one `updateRange` per match (identical
 * insert-or-replace-by-id semantics to `WorkbookStore.ingredients.upsert`
 * — see `upsertByKey` in workbook-store.ts, which this deliberately
 * mirrors) — only the "not found yet" path changed, from N individual
 * appends to one batched append. This is bootstrap-internal only, not a
 * change to `WorkbookStore`'s frozen contract (src/domain/README.md):
 * every other caller still upserts ingredients one at a time through the
 * store, same as before.
 */
async function seedIngredients(transport: SheetsTransport): Promise<void> {
  const lastCol = columnLetter(INGREDIENTS_HEADER.length);
  const existingRows = await transport.readRange(`Ingredients!A2:${lastCol}`);

  const existingRowIndexById = new Map<string, number>();
  existingRows.forEach((row, index) => {
    if (isBlankRow(row)) return;
    try {
      existingRowIndexById.set(decodeIngredient(row).id, index);
    } catch {
      // Malformed existing row — can't tell what its id is; leave it alone,
      // same "quarantine, don't crash" treatment as upsertByKey.
    }
  });

  const newRows: CellRow[] = [];
  for (const ingredient of seedCatalog) {
    const matchIndex = existingRowIndexById.get(ingredient.id);
    if (matchIndex === undefined) {
      newRows.push(encodeIngredient(ingredient));
      continue;
    }
    const rowNumber = matchIndex + 2; // +1 for the header row, +1 for 0-based -> 1-based.
    await transport.updateRange(`Ingredients!A${rowNumber}:${lastCol}${rowNumber}`, [encodeIngredient(ingredient)]);
  }

  if (newRows.length > 0) {
    await transport.appendRows("Ingredients", newRows);
  }
}
