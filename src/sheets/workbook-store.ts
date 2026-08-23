/**
 * `WorkbookStore` implementation on top of `SheetsTransport` (WP-11). Every
 * namespace round-trips through the row<->entity codecs in ./codecs/*.ts;
 * malformed rows are quarantined as `DataWarning`s, never thrown (WP-11 BDD
 * "Malformed row does not break loading").
 *
 * --- No delete-row operation ---
 * `SheetsTransport` only exposes readRange/batchRead/appendRows/updateRange
 * (contracts.ts) — there is no "delete row N" call. Two write shapes fall
 * out of that:
 *
 *  - upsert-by-id (ingredients/recipes/planSlots/shoppingItems): a matching
 *    row is overwritten in place with `updateRange` on exactly that one
 *    row; an unmatched id is appended. Row count never shrinks, so this
 *    needs no padding.
 *  - full-block replace (Settings, Meta, and RecipeIngredients/RecipeSteps'
 *    `replaceForRecipe`): the new content can be shorter than what is
 *    already there, so `writeDataBlock` pads the tail with blank rows up to
 *    the previous extent. `decodeRows` (codecs/common.ts) treats an
 *    all-blank row as structural filler and skips it silently, not as a
 *    `DataWarning` — it is this codec layer's own artefact, not something a
 *    human typed.
 *
 * --- Invariant 3 (one canonical unit per ingredient) ---
 * `recipeIngredients` is the only namespace that needs another sheet
 * (Ingredients) to validate itself: a `RecipeIngredient`'s `quantity.unit`
 * must equal its ingredient's canonical unit. `readAll()` cross-checks and
 * quarantines a mismatched row as a `DataWarning` (a human could have
 * hand-edited `quantity_unit`); `replaceForRecipe()` cross-checks the same
 * way but *throws* before writing anything — a write from the app itself
 * with a mismatched unit is a programming error, not a data-entry mistake a
 * human corrects in place, and this method's signature has no
 * `DecodeResult` channel to report a warning through.
 */
import type {
  CellRow,
  DecodeResult,
  InventoryEventsPage,
  SheetsTransport,
  WorkbookStore,
} from "../domain/contracts.ts";
import type {
  Ingredient,
  IngredientId,
  InventoryEvent,
  Meta,
  Photo,
  PhotoOwnerId,
  PhotoOwnerKind,
  PlanSlot,
  PriceObservation,
  Product,
  ProductBarcode,
  Recipe,
  RecipeId,
  RecipeIngredient,
  RecipeStep,
  Settings,
  ShoppingItem,
  Unit,
  WorkbookSheetName,
} from "../domain/types.ts";
import {
  blankRow,
  columnLetter,
  decodeIngredient,
  decodeInventoryEvent,
  decodeMeta,
  decodePhoto,
  decodePlanSlot,
  decodePriceObservation,
  decodeProduct,
  decodeProductBarcode,
  decodeRecipe,
  decodeRecipeIngredient,
  decodeRecipeStep,
  decodeRows,
  decodeSettings,
  decodeShoppingItem,
  encodeIngredient,
  encodeInventoryEvent,
  encodeMeta,
  encodePhoto,
  encodePlanSlot,
  encodePriceObservation,
  encodeProduct,
  encodeProductBarcode,
  encodeRecipe,
  encodeRecipeIngredient,
  encodeRecipeStep,
  encodeSettings,
  encodeShoppingItem,
  INGREDIENTS_HEADER,
  INVENTORY_EVENTS_HEADER,
  isBlankRow,
  META_HEADER,
  PHOTOS_HEADER,
  PLAN_SLOTS_HEADER,
  PRICE_OBSERVATIONS_HEADER,
  PRODUCT_BARCODES_HEADER,
  PRODUCTS_HEADER,
  RECIPE_INGREDIENTS_HEADER,
  RECIPE_STEPS_HEADER,
  RECIPES_HEADER,
  SETTINGS_HEADER,
  SHOPPING_ITEMS_HEADER,
} from "./codecs/index.ts";

async function readDataRows(
  transport: SheetsTransport,
  sheet: WorkbookSheetName,
  header: CellRow,
): Promise<CellRow[]> {
  const lastCol = columnLetter(header.length);
  return [...(await transport.readRange(`${sheet}!A2:${lastCol}`))];
}

/**
 * Writes the header row if row 1 is empty. `bootstrapWorkbook` already does
 * this eagerly for all nine sheets, but every write path here calls this
 * too so the store is correct on its own, without depending on bootstrap
 * having run first — e.g. `describeWorkbookStoreContract`
 * (src/domain/contract-tests/workbook-store.contract.ts) exercises a raw
 * subject directly, with no header row pre-written. Without this, the very
 * first `appendRows` call on an untouched sheet would land its data at
 * physical row 1 (the row every read here treats as the header, always
 * starting from row 2), silently losing that row on the next read.
 */
async function ensureHeader(transport: SheetsTransport, sheet: WorkbookSheetName, header: CellRow): Promise<void> {
  const lastCol = columnLetter(header.length);
  const existing = await transport.readRange(`${sheet}!A1:${lastCol}1`);
  const firstRow = existing[0];
  if (firstRow && !isBlankRow(firstRow)) return;
  await transport.updateRange(`${sheet}!A1:${lastCol}1`, [header]);
}

/** Writes `newRows` starting at row 2, padding any leftover previously-occupied rows with blanks. */
async function writeDataBlock(
  transport: SheetsTransport,
  sheet: WorkbookSheetName,
  header: CellRow,
  newRows: readonly CellRow[],
  previousLength: number,
): Promise<void> {
  await ensureHeader(transport, sheet, header);
  const lastCol = columnLetter(header.length);
  const total = Math.max(previousLength, newRows.length);
  if (total === 0) return;
  const padded: CellRow[] = [];
  for (let i = 0; i < total; i += 1) {
    padded.push(newRows[i] ?? blankRow(header.length));
  }
  await transport.updateRange(`${sheet}!A2:${lastCol}${1 + total}`, padded);
}

/** Full-sheet rewrite: reads the current extent first so a shrinking write still blanks the leftover tail. */
async function rewriteAllRows(
  transport: SheetsTransport,
  sheet: WorkbookSheetName,
  header: CellRow,
  newRows: readonly CellRow[],
): Promise<void> {
  const existing = await readDataRows(transport, sheet, header);
  await writeDataBlock(transport, sheet, header, newRows, existing.length);
}

/** Reads and decodes a whole "one row = one entity" sheet. */
async function readAllOf<T>(
  transport: SheetsTransport,
  sheet: WorkbookSheetName,
  header: CellRow,
  decodeOne: (row: CellRow) => T,
): Promise<DecodeResult<T>> {
  const raw = await readDataRows(transport, sheet, header);
  return decodeRows(sheet, raw, 2, decodeOne);
}

/** Insert-or-replace-by-key: overwrites the one matching row in place, or appends a new one. No delete, so row count only ever grows. */
async function upsertByKey<T>(
  transport: SheetsTransport,
  sheet: WorkbookSheetName,
  header: CellRow,
  decodeOne: (row: CellRow) => T,
  encodeOne: (entity: T) => CellRow,
  keyOf: (entity: T) => string,
  entity: T,
): Promise<void> {
  const lastCol = columnLetter(header.length);
  const raw = await readDataRows(transport, sheet, header);
  const key = keyOf(entity);
  let matchIndex = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i];
    if (!row || isBlankRow(row)) continue;
    try {
      if (keyOf(decodeOne(row)) === key) {
        matchIndex = i;
        break;
      }
    } catch {
      // Malformed existing row — can't tell what its key is; leave it alone, it isn't this entity.
    }
  }
  const encoded = encodeOne(entity);
  if (matchIndex >= 0) {
    const rowNumber = matchIndex + 2;
    await transport.updateRange(`${sheet}!A${rowNumber}:${lastCol}${rowNumber}`, [encoded]);
  } else {
    // ensureHeader first: appendRows lands right after the sheet's current
    // last physical row, which must be the header (row 1) on an
    // untouched sheet so this new row lands at row 2, matching every read
    // path above (which always starts from row 2).
    await ensureHeader(transport, sheet, header);
    await transport.appendRows(sheet, [encoded]);
  }
}

/** Replaces every row whose first cell (recipe_id) equals `recipeId`, keeping every other recipe's rows untouched — RecipeIngredients/RecipeSteps' `replaceForRecipe`. */
async function replaceRowsForRecipe(
  transport: SheetsTransport,
  sheet: WorkbookSheetName,
  header: CellRow,
  recipeId: RecipeId,
  newRows: readonly CellRow[],
): Promise<void> {
  const existing = await readDataRows(transport, sheet, header);
  const kept = existing.filter((row) => !isBlankRow(row) && row[0] !== recipeId);
  await writeDataBlock(transport, sheet, header, [...kept, ...newRows], existing.length);
}

async function readIngredients(transport: SheetsTransport): Promise<DecodeResult<Ingredient>> {
  return readAllOf(transport, "Ingredients", INGREDIENTS_HEADER, decodeIngredient);
}

/**
 * Locates the physical row (1-based, header always row 1) whose first two
 * columns equal `(ownerKind, ownerId)`, reading ONLY those two columns —
 * never `data_url`/`updated_at`. This is what lets `photos.get`/`upsert`/
 * `remove` (below) find "which row is this owner" without pulling every
 * other photo's bytes down the wire just to search for one row
 * (DESIGN_PHOTOS.md §2/§6: the entire reason `Photos` is split into its own
 * sheet with no `readAll`). Returns -1 if no row matches.
 */
async function findPhotoRow(transport: SheetsTransport, ownerKind: PhotoOwnerKind, ownerId: PhotoOwnerId): Promise<number> {
  const columns = await transport.readRange(`Photos!A2:B`);
  for (let i = 0; i < columns.length; i += 1) {
    const row = columns[i];
    if (row?.[0] === ownerKind && row[1] === ownerId) return i + 2;
  }
  return -1;
}

function shoppingItemKey(item: Pick<ShoppingItem, "ingredientId" | "rangeStart" | "rangeEnd">): string {
  return `${item.ingredientId}|${item.rangeStart}|${item.rangeEnd}`;
}

export function createSheetsWorkbookStore(transport: SheetsTransport): WorkbookStore {
  return {
    meta: {
      async read(): Promise<Meta> {
        const raw = await readDataRows(transport, "Meta", META_HEADER);
        const firstRow = raw.find((row) => !isBlankRow(row));
        if (!firstRow) {
          throw new Error("Meta sheet has no data row — the workbook was not bootstrapped correctly.");
        }
        return decodeMeta(firstRow);
      },
      async write(meta: Meta): Promise<void> {
        await rewriteAllRows(transport, "Meta", META_HEADER, [encodeMeta(meta)]);
      },
    },

    settings: {
      async read(): Promise<Settings> {
        const raw = await readDataRows(transport, "Settings", SETTINGS_HEADER);
        return decodeSettings(raw);
      },
      async write(settings: Settings): Promise<void> {
        await rewriteAllRows(transport, "Settings", SETTINGS_HEADER, encodeSettings(settings));
      },
    },

    ingredients: {
      async readAll(): Promise<DecodeResult<Ingredient>> {
        return readIngredients(transport);
      },
      async upsert(ingredient: Ingredient): Promise<void> {
        await upsertByKey(
          transport,
          "Ingredients",
          INGREDIENTS_HEADER,
          decodeIngredient,
          encodeIngredient,
          (i) => i.id,
          ingredient,
        );
      },
    },

    recipes: {
      async readAll(): Promise<DecodeResult<Recipe>> {
        return readAllOf(transport, "Recipes", RECIPES_HEADER, decodeRecipe);
      },
      async upsert(recipe: Recipe): Promise<void> {
        await upsertByKey(transport, "Recipes", RECIPES_HEADER, decodeRecipe, encodeRecipe, (r) => r.id, recipe);
      },
    },

    recipeIngredients: {
      async readAll(): Promise<DecodeResult<RecipeIngredient>> {
        const { rows: ingredientRows } = await readIngredients(transport);
        const canonical = new Map<IngredientId, Unit>(ingredientRows.map((i): [IngredientId, Unit] => [i.id, i.unit]));
        const raw = await readDataRows(transport, "RecipeIngredients", RECIPE_INGREDIENTS_HEADER);
        return decodeRows("RecipeIngredients", raw, 2, (row) =>
          decodeRecipeIngredient(row, (id) => canonical.get(id)),
        );
      },
      async replaceForRecipe(recipeId: RecipeId, lines: readonly RecipeIngredient[]): Promise<void> {
        const { rows: ingredientRows } = await readIngredients(transport);
        // Only a *known* mismatch is rejected here — if the ingredient
        // isn't in the catalog (yet), there's nothing to compare against,
        // so the write is let through; a later readAll() cross-checks
        // again and quarantines it as a DataWarning if it's still
        // unresolvable then (see decodeRecipeIngredient in
        // ./codecs/recipe-ingredients.ts).
        const canonical = new Map<IngredientId, Unit>(ingredientRows.map((i): [IngredientId, Unit] => [i.id, i.unit]));
        for (const line of lines) {
          const unit = canonical.get(line.ingredientId);
          if (unit !== undefined && unit !== line.quantity.unit) {
            throw new Error(
              `Cannot save recipe ingredient: "${line.ingredientId}"'s canonical unit is "${unit}", but this line specifies "${line.quantity.unit}" — each ingredient has one unit, and amounts are never converted.`,
            );
          }
        }
        await replaceRowsForRecipe(
          transport,
          "RecipeIngredients",
          RECIPE_INGREDIENTS_HEADER,
          recipeId,
          lines.map(encodeRecipeIngredient),
        );
      },
    },

    recipeSteps: {
      async readAll(): Promise<DecodeResult<RecipeStep>> {
        return readAllOf(transport, "RecipeSteps", RECIPE_STEPS_HEADER, decodeRecipeStep);
      },
      async replaceForRecipe(recipeId: RecipeId, steps: readonly RecipeStep[]): Promise<void> {
        await replaceRowsForRecipe(
          transport,
          "RecipeSteps",
          RECIPE_STEPS_HEADER,
          recipeId,
          steps.map(encodeRecipeStep),
        );
      },
    },

    planSlots: {
      async readAll(): Promise<DecodeResult<PlanSlot>> {
        return readAllOf(transport, "PlanSlots", PLAN_SLOTS_HEADER, decodePlanSlot);
      },
      async upsert(slot: PlanSlot): Promise<void> {
        await upsertByKey(transport, "PlanSlots", PLAN_SLOTS_HEADER, decodePlanSlot, encodePlanSlot, (s) => s.id, slot);
      },
    },

    inventoryEvents: {
      async readFrom(cursor: number): Promise<InventoryEventsPage> {
        const lastCol = columnLetter(INVENTORY_EVENTS_HEADER.length);
        const startRow = cursor + 2;
        const raw = await transport.readRange(`InventoryEvents!A${startRow}:${lastCol}`);
        const { rows, warnings } = decodeRows("InventoryEvents", raw, startRow, decodeInventoryEvent);
        return { rows, warnings, nextCursor: cursor + raw.length };
      },
      async append(event: InventoryEvent): Promise<void> {
        await ensureHeader(transport, "InventoryEvents", INVENTORY_EVENTS_HEADER);
        await transport.appendRows("InventoryEvents", [encodeInventoryEvent(event)]);
      },
    },

    shoppingItems: {
      async readAll(): Promise<DecodeResult<ShoppingItem>> {
        return readAllOf(transport, "ShoppingItems", SHOPPING_ITEMS_HEADER, decodeShoppingItem);
      },
      async upsert(item: ShoppingItem): Promise<void> {
        await upsertByKey(
          transport,
          "ShoppingItems",
          SHOPPING_ITEMS_HEADER,
          decodeShoppingItem,
          encodeShoppingItem,
          shoppingItemKey,
          item,
        );
      },
    },

    products: {
      async readAll(): Promise<DecodeResult<Product>> {
        return readAllOf(transport, "Products", PRODUCTS_HEADER, decodeProduct);
      },
      async upsert(product: Product): Promise<void> {
        await upsertByKey(transport, "Products", PRODUCTS_HEADER, decodeProduct, encodeProduct, (p) => p.id, product);
      },
    },

    productBarcodes: {
      async readAll(): Promise<DecodeResult<ProductBarcode>> {
        return readAllOf(transport, "ProductBarcodes", PRODUCT_BARCODES_HEADER, decodeProductBarcode);
      },
      async upsert(row: ProductBarcode): Promise<void> {
        await upsertByKey(
          transport,
          "ProductBarcodes",
          PRODUCT_BARCODES_HEADER,
          decodeProductBarcode,
          encodeProductBarcode,
          (r) => r.barcode,
          row,
        );
      },
    },

    photos: {
      async get(ownerKind: PhotoOwnerKind, ownerId: PhotoOwnerId): Promise<Photo | undefined> {
        const row = await findPhotoRow(transport, ownerKind, ownerId);
        if (row < 0) return undefined;
        const lastCol = columnLetter(PHOTOS_HEADER.length);
        const range = await transport.readRange(`Photos!A${row}:${lastCol}${row}`);
        const data = range[0];
        if (!data || isBlankRow(data)) return undefined;
        return decodePhoto(data);
      },
      async upsert(photo: Photo): Promise<void> {
        // Encode (and therefore the 50,000-character cell-limit check —
        // see codecs/photos.ts) happens before any I/O: an oversized photo
        // must fail loudly without first spending a round trip searching
        // for a row to (not) write it to.
        const encoded = encodePhoto(photo);
        const lastCol = columnLetter(PHOTOS_HEADER.length);
        const row = await findPhotoRow(transport, photo.ownerKind, photo.ownerId);
        if (row >= 0) {
          await transport.updateRange(`Photos!A${row}:${lastCol}${row}`, [encoded]);
        } else {
          await ensureHeader(transport, "Photos", PHOTOS_HEADER);
          await transport.appendRows("Photos", [encoded]);
        }
      },
      async remove(ownerKind: PhotoOwnerKind, ownerId: PhotoOwnerId): Promise<void> {
        // No delete-row operation on SheetsTransport (see this file's own
        // header doc comment) — overwrite the row with blanks instead, same
        // "structural filler, skipped silently on read" treatment as a
        // shrinking replaceForRecipe block (isBlankRow/decodeRows above).
        const row = await findPhotoRow(transport, ownerKind, ownerId);
        if (row < 0) return;
        const lastCol = columnLetter(PHOTOS_HEADER.length);
        await transport.updateRange(`Photos!A${row}:${lastCol}${row}`, [blankRow(PHOTOS_HEADER.length)]);
      },
    },

    priceObservations: {
      async readAll(): Promise<DecodeResult<PriceObservation>> {
        return readAllOf(transport, "PriceObservations", PRICE_OBSERVATIONS_HEADER, decodePriceObservation);
      },
      async append(observation: PriceObservation): Promise<void> {
        await ensureHeader(transport, "PriceObservations", PRICE_OBSERVATIONS_HEADER);
        await transport.appendRows("PriceObservations", [encodePriceObservation(observation)]);
      },
    },
  };
}
