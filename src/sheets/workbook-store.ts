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
  CellGrid,
  CellRow,
  DecodeResult,
  InventoryEventsPage,
  SheetsTransport,
  WorkbookStore,
} from "../domain/contracts.ts";
import type {
  Barcode,
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
  ProductId,
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

// ---------------------------------------------------------------------------
// Request-volume fix (WP-fix-sheets-429) — two additive layers, both scoped
// to READS only (never touch appendRows/updateRange), both built entirely on
// top of the existing SheetsTransport contract (frozen — nothing here
// widens it):
//
//  1. `createBatchedReader` coalesces every `readRange` call issued in the
//     same microtask tick into one `transport.batchRead` (`values:batchGet`)
//     round trip. A route that does
//     `Promise.all([store.recipes.readAll(), store.ingredients.readAll(),
//     store.recipeIngredients.readAll()])` used to cost three HTTP requests;
//     all three `readRange` calls fire synchronously within that same
//     `Promise.all` before anything awaits, so they land in the same batch
//     and now cost one. `batchRead` already falls back to per-range reads on
//     a missing-tab error (transport.ts), so a stale workbook loses none of
//     that tolerance — it just also loses the batching for that one group.
//     Used by the read-only `readAll()`/`read()` entry points below (via
//     `readDataRowsWith`). Deliberately NOT used by the write-path helpers'
//     own "read current rows first" step (`readDataRows`, unchanged,
//     `transport.readRange` directly) — a write choosing its target row
//     should queue behind nothing else in flight, kept simple and
//     unconditionally synchronous with the write that follows it.
//
//  2. `createSheetReadCache` (below, used by the returned store's `readAll`
//     methods only — see its own doc comment) adds in-flight
//     de-duplication on top — NOT a time-based cache, deliberately: see
//     that function's own doc comment for why a TTL here reintroduced the
//     exact staleness invariant 5 warns about, and was removed.
// ---------------------------------------------------------------------------

/**
 * Coalesces every `readRange` call made within one microtask tick into a
 * single `transport.batchRead`. A lone call (the common case for a write
 * path's own pre-read) still costs exactly one `readRange`-equivalent round
 * trip — no batching overhead for the unbatched case.
 */
function createBatchedReader(transport: SheetsTransport): (range: string) => Promise<CellGrid> {
  interface QueuedRead {
    readonly range: string;
    readonly resolve: (grid: CellGrid) => void;
    readonly reject: (err: unknown) => void;
  }
  let queue: QueuedRead[] = [];
  let scheduled = false;

  function flush(): void {
    const batch = queue;
    queue = [];
    scheduled = false;
    if (batch.length === 1) {
      const only = batch[0]!;
      transport.readRange(only.range).then(only.resolve, only.reject);
      return;
    }
    transport.batchRead(batch.map((entry) => entry.range)).then(
      (grids) => {
        batch.forEach((entry, i) => entry.resolve(grids[i] ?? []));
      },
      (err: unknown) => {
        batch.forEach((entry) => entry.reject(err));
      },
    );
  }

  return function readRangeBatched(range: string): Promise<CellGrid> {
    return new Promise<CellGrid>((resolve, reject) => {
      queue.push({ range, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
  };
}

/**
 * Sheets this file caches `readAll()`/`read()` results for — deliberately
 * NOT `InventoryEvents` (WP-17's `syncSnapshot` already does the real,
 * correctness-critical incremental cache via generation + cursor, invariant
 * 2 — a second, unrelated cache here would only risk fighting it) and NOT
 * `Meta`/`Settings` (small, and `Meta.generation` is exactly the value
 * cursor-safety checks against — it must always be read fresh, never served
 * a few seconds stale).
 */
// A subtype of WorkbookSheetName (enforced structurally: every literal here
// must also be a valid WorkbookSheetName, or TypeScript rejects the `extends`
// clause) - no runtime array, since nothing below needs the list as a value,
// only as this union type.
type CacheableReadSheet = Extract<
  WorkbookSheetName,
  | "Ingredients"
  | "Recipes"
  | "RecipeIngredients"
  | "RecipeSteps"
  | "PlanSlots"
  | "ShoppingItems"
  | "Products"
  | "ProductBarcodes"
  | "PriceObservations"
>;

/**
 * In-flight de-duplication (deliberately NOT a time-based cache — see
 * below) for the nine mostly-read, fully-replaced-on-write sheets above.
 * Exists to collapse the "two components/hooks call the same `readAll()`
 * at once" pattern (e.g. `recipeIngredients.readAll()` reading
 * `Ingredients` a second time on top of a route's own
 * `ingredients.readAll()`, both fired from the same `Promise.all`) into one
 * network request, without a time-based cache's staleness risk:
 *
 *  - While a `readAll()` for a sheet is in flight, a second call for the
 *    SAME sheet on this instance reuses that same promise instead of
 *    issuing a second request. The moment it settles (success OR failure),
 *    the entry is removed - the very next call always starts a fresh
 *    network request. There is no "serve the last result for N seconds"
 *    behaviour here at all.
 *  - This is deliberately weaker than a real cache: an EARLIER version of
 *    this fix kept each result for a short TTL after it resolved, and that
 *    reintroduced exactly the staleness invariant 5 warns about. A write to
 *    the SAME workbook through a DIFFERENT `WorkbookStore` instance -
 *    another open tab, another signed-in device (a first-class case here -
 *    HANDOVER.md's whole `drive.file` design point is Sheets sharing), or
 *    (as several `e2e/*.spec.ts` seeding helpers do) a freshly-constructed
 *    store used once to seed rows before the app's own store reads them -
 *    is invisible to THIS instance's cache, since only writes made THROUGH
 *    this instance invalidate it. A TTL only bounds that window; it does
 *    not close it, and a route that mounted (and cached) moments before
 *    such an external write would show stale data for the rest of the TTL.
 *    De-duplicating in-flight calls has no such window: nothing is ever
 *    reused after it resolves, so an external write is only ever missed by
 *    a request that was ALREADY in flight before the write happened -
 *    exactly as true without any caching at all.
 *  - Every write through THIS SAME store instance (`upsert`/`remove`/
 *    `replaceForRecipe`/`append`) still calls `invalidate` for the
 *    sheet(s) it touched, so a call that arrives WHILE an in-flight read
 *    from before the write is still pending does not accidentally join it
 *    and see pre-write data.
 *  - `write`-path helpers (`upsertByKey`/`removeByKey`/`rewriteAllRows`/
 *    `replaceRowsForRecipe`) never read through this de-dupe — they call
 *    `readDataRows` directly, always hitting the network, because a write
 *    that computed its target row from a stale/shared in-flight read could
 *    overwrite the wrong row or under-pad a shrinking block. Only the
 *    public `readAll()`/`read()` entry points below go through it.
 */
/**
 * The generic in-flight-only de-dupe primitive both `createSheetReadCache`
 * and the Photos namespace below are built on: while a `load()` for a given
 * `key` is pending, a second `dedupe` call for that SAME key reuses the same
 * promise; the moment it settles (success or failure), the entry is removed
 * — nothing is ever served after it has already resolved. See
 * `createSheetReadCache`'s own doc comment for why this project deliberately
 * does not keep a time-based cache here.
 */
function createInFlightMap<V>() {
  const inFlight = new Map<string, Promise<V>>();

  async function dedupe(key: string, load: () => Promise<V>): Promise<V> {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = load();
    inFlight.set(key, promise);
    promise
      .finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      })
      .catch(() => {
        // The rejection is still delivered to every real awaiter of
        // `promise` above; this second handler only stops it also being
        // reported as an unhandled rejection for this bookkeeping chain.
      });
    return promise;
  }

  function forget(key: string): void {
    inFlight.delete(key);
  }

  return { dedupe, forget };
}

function createSheetReadCache() {
  const map = createInFlightMap<unknown>();

  async function cached<T>(sheet: CacheableReadSheet, load: () => Promise<T>): Promise<T> {
    return map.dedupe(sheet, load) as Promise<T>;
  }

  function invalidate(...sheets: readonly CacheableReadSheet[]): void {
    for (const sheet of sheets) map.forget(sheet);
  }

  return { cached, invalidate };
}

async function readDataRowsWith(
  readRange: (range: string) => Promise<CellGrid>,
  sheet: WorkbookSheetName,
  header: CellRow,
): Promise<CellRow[]> {
  const lastCol = columnLetter(header.length);
  return [...(await readRange(`${sheet}!A2:${lastCol}`))];
}

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

/**
 * Detach-by-key: overwrites the one matching row with blanks (same "no
 * delete-row primitive" treatment as `photos.remove` — see this file's own
 * header comment). A no-op, not an error, when no row matches: removing
 * something already gone is idempotent, same discipline as every other
 * write in this file.
 */
async function removeByKey<T>(
  transport: SheetsTransport,
  sheet: WorkbookSheetName,
  header: CellRow,
  decodeOne: (row: CellRow) => T,
  keyOf: (entity: T) => string,
  key: string,
): Promise<void> {
  const lastCol = columnLetter(header.length);
  const raw = await readDataRows(transport, sheet, header);
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
      // Malformed existing row — can't tell what its key is; leave it alone.
    }
  }
  if (matchIndex < 0) return;
  const rowNumber = matchIndex + 2;
  await transport.updateRange(`${sheet}!A${rowNumber}:${lastCol}${rowNumber}`, [blankRow(header.length)]);
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

function shoppingItemKey(item: Pick<ShoppingItem, "ingredientId" | "rangeStart" | "rangeEnd">): string {
  return `${item.ingredientId}|${item.rangeStart}|${item.rangeEnd}`;
}

function photoOwnerKey(ownerKind: PhotoOwnerKind, ownerId: PhotoOwnerId): string {
  return `${ownerKind}:${ownerId}`;
}

export function createSheetsWorkbookStore(transport: SheetsTransport): WorkbookStore {
  // One batched reader + one read cache per store instance (module-level
  // state would leak across workbooks/tests — see this section's own header
  // comment above for what each layer does and why).
  const readRangeBatched = createBatchedReader(transport);
  const cache = createSheetReadCache();

  async function readAllCached<T>(
    sheet: CacheableReadSheet,
    header: CellRow,
    decodeOne: (row: CellRow) => T,
  ): Promise<DecodeResult<T>> {
    return cache.cached(sheet, async () => {
      const raw = await readDataRowsWith(readRangeBatched, sheet, header);
      return decodeRows(sheet, raw, 2, decodeOne);
    });
  }

  async function readIngredientsCached(): Promise<DecodeResult<Ingredient>> {
    return readAllCached("Ingredients", INGREDIENTS_HEADER, decodeIngredient);
  }

  // ---------------------------------------------------------------------
  // Photos (DESIGN_PHOTOS.md §2/§6) — still deliberately no `readAll`
  // (see this file's original header comment on that namespace: pulling
  // every image down on a listing load is exactly what the sheet split
  // exists to avoid), but `get`/`upsert`/`remove` no longer each cost a
  // full "scan every owner row" request of their own.
  //
  // A `(ownerKind, ownerId) -> row number` index is built on demand and
  // shared by every call CONCURRENTLY in flight (same in-flight-only
  // de-duplication as `createSheetReadCache` above, and for the same
  // reason: an earlier version of this kept the index for the rest of the
  // store instance's lifetime, and a photo added by a DIFFERENT store
  // instance on the same workbook — another open tab, another device, an
  // e2e seeding helper — would never appear in it. See
  // `createSheetReadCache`'s doc comment for the full reasoning; this is
  // the same fix applied to photos).
  //
  // What this still buys, without that risk: React renders every visible
  // `PhotoMedia` in the same pass, so a screen with a dozen photographed
  // items fires a dozen `photos.get()` calls within the same microtask
  // window. All of them share ONE index-scan request (in-flight de-dupe),
  // and their dozen individual data-cell reads all land in the SAME
  // microtask too, so `createBatchedReader` above folds them into ONE
  // `batchRead` HTTP call. Net cost for that screen: two requests, not
  // twenty-four — the amplification this WP exists to fix — even though
  // nothing here is retained past that render.
  const photoIndexCache = createInFlightMap<Map<string, number>>();
  const photoResultCache = createInFlightMap<Photo | undefined>();

  async function loadPhotoRowIndex(): Promise<Map<string, number>> {
    return photoIndexCache.dedupe("index", async () => {
      const columns = await readRangeBatched(`Photos!A2:B`);
      const index = new Map<string, number>();
      columns.forEach((row, i) => {
        const kind = row[0];
        const id = row[1];
        if (kind && id) index.set(photoOwnerKey(kind as PhotoOwnerKind, id as PhotoOwnerId), i + 2);
      });
      return index;
    });
  }

  return {
    meta: {
      async read(): Promise<Meta> {
        const raw = await readDataRowsWith(readRangeBatched, "Meta", META_HEADER);
        const firstRow = raw.find((row) => !isBlankRow(row));
        if (!firstRow) {
          // Plain language on purpose (jargon sweep, WP-tokens follow-up):
          // this string reaches users verbatim — every route's data hook
          // (Pantry/Plan/Scan/Shopping all call `meta.read()`) passes its
          // caught error straight into `ErrorState`'s `description` with no
          // per-route rewording, same pattern as `decodeSettings`'s sibling
          // in codecs/settings.ts.
          throw new Error("This meal planner looks incomplete — it may not have finished being created.");
        }
        return decodeMeta(firstRow);
      },
      async write(meta: Meta): Promise<void> {
        await rewriteAllRows(transport, "Meta", META_HEADER, [encodeMeta(meta)]);
      },
    },

    settings: {
      async read(): Promise<Settings> {
        const raw = await readDataRowsWith(readRangeBatched, "Settings", SETTINGS_HEADER);
        return decodeSettings(raw);
      },
      async write(settings: Settings): Promise<void> {
        await rewriteAllRows(transport, "Settings", SETTINGS_HEADER, encodeSettings(settings));
      },
    },

    ingredients: {
      async readAll(): Promise<DecodeResult<Ingredient>> {
        return readIngredientsCached();
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
        // RecipeIngredients' readAll cross-checks every line against
        // Ingredients' own canonical units (invariant 3) - an ingredient
        // edit can flip what that cross-check would report, so both caches
        // invalidate together.
        cache.invalidate("Ingredients", "RecipeIngredients");
      },
    },

    recipes: {
      async readAll(): Promise<DecodeResult<Recipe>> {
        return readAllCached("Recipes", RECIPES_HEADER, decodeRecipe);
      },
      async upsert(recipe: Recipe): Promise<void> {
        await upsertByKey(transport, "Recipes", RECIPES_HEADER, decodeRecipe, encodeRecipe, (r) => r.id, recipe);
        cache.invalidate("Recipes");
      },
    },

    recipeIngredients: {
      async readAll(): Promise<DecodeResult<RecipeIngredient>> {
        return cache.cached("RecipeIngredients", async () => {
          const [{ rows: ingredientRows }, raw] = await Promise.all([
            readIngredientsCached(),
            readDataRowsWith(readRangeBatched, "RecipeIngredients", RECIPE_INGREDIENTS_HEADER),
          ]);
          const canonical = new Map<IngredientId, Unit>(ingredientRows.map((i): [IngredientId, Unit] => [i.id, i.unit]));
          return decodeRows("RecipeIngredients", raw, 2, (row) =>
            decodeRecipeIngredient(row, (id) => canonical.get(id)),
          );
        });
      },
      async replaceForRecipe(recipeId: RecipeId, lines: readonly RecipeIngredient[]): Promise<void> {
        const { rows: ingredientRows } = await readIngredientsCached();
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
        cache.invalidate("RecipeIngredients");
      },
    },

    recipeSteps: {
      async readAll(): Promise<DecodeResult<RecipeStep>> {
        return readAllCached("RecipeSteps", RECIPE_STEPS_HEADER, decodeRecipeStep);
      },
      async replaceForRecipe(recipeId: RecipeId, steps: readonly RecipeStep[]): Promise<void> {
        await replaceRowsForRecipe(
          transport,
          "RecipeSteps",
          RECIPE_STEPS_HEADER,
          recipeId,
          steps.map(encodeRecipeStep),
        );
        cache.invalidate("RecipeSteps");
      },
    },

    planSlots: {
      async readAll(): Promise<DecodeResult<PlanSlot>> {
        return readAllCached("PlanSlots", PLAN_SLOTS_HEADER, decodePlanSlot);
      },
      async upsert(slot: PlanSlot): Promise<void> {
        await upsertByKey(transport, "PlanSlots", PLAN_SLOTS_HEADER, decodePlanSlot, encodePlanSlot, (s) => s.id, slot);
        cache.invalidate("PlanSlots");
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
        return readAllCached("ShoppingItems", SHOPPING_ITEMS_HEADER, decodeShoppingItem);
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
        cache.invalidate("ShoppingItems");
      },
    },

    products: {
      async readAll(): Promise<DecodeResult<Product>> {
        return readAllCached("Products", PRODUCTS_HEADER, decodeProduct);
      },
      async upsert(product: Product): Promise<void> {
        await upsertByKey(transport, "Products", PRODUCTS_HEADER, decodeProduct, encodeProduct, (p) => p.id, product);
        cache.invalidate("Products");
      },
      async remove(productId: ProductId): Promise<void> {
        await removeByKey(transport, "Products", PRODUCTS_HEADER, decodeProduct, (p) => p.id, productId);
        cache.invalidate("Products");
      },
    },

    productBarcodes: {
      async readAll(): Promise<DecodeResult<ProductBarcode>> {
        return readAllCached("ProductBarcodes", PRODUCT_BARCODES_HEADER, decodeProductBarcode);
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
        cache.invalidate("ProductBarcodes");
      },
      async remove(barcode: Barcode): Promise<void> {
        await removeByKey(transport, "ProductBarcodes", PRODUCT_BARCODES_HEADER, decodeProductBarcode, (r) => r.barcode, barcode);
        cache.invalidate("ProductBarcodes");
      },
    },

    photos: {
      async get(ownerKind: PhotoOwnerKind, ownerId: PhotoOwnerId): Promise<Photo | undefined> {
        const key = photoOwnerKey(ownerKind, ownerId);
        return photoResultCache.dedupe(key, async () => {
          const index = await loadPhotoRowIndex();
          const row = index.get(key);
          if (row === undefined) return undefined;
          const lastCol = columnLetter(PHOTOS_HEADER.length);
          const range = await readRangeBatched(`Photos!A${row}:${lastCol}${row}`);
          const data = range[0];
          if (!data || isBlankRow(data)) return undefined;
          return decodePhoto(data);
        });
      },
      async upsert(photo: Photo): Promise<void> {
        // Encode (and therefore the 50,000-character cell-limit check —
        // see codecs/photos.ts) happens before any I/O: an oversized photo
        // must fail loudly without first spending a round trip searching
        // for a row to (not) write it to.
        const encoded = encodePhoto(photo);
        const lastCol = columnLetter(PHOTOS_HEADER.length);
        const key = photoOwnerKey(photo.ownerKind, photo.ownerId);
        const index = await loadPhotoRowIndex();
        const row = index.get(key);
        if (row !== undefined) {
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
        const key = photoOwnerKey(ownerKind, ownerId);
        const index = await loadPhotoRowIndex();
        const row = index.get(key);
        if (row === undefined) return;
        const lastCol = columnLetter(PHOTOS_HEADER.length);
        await transport.updateRange(`Photos!A${row}:${lastCol}${row}`, [blankRow(PHOTOS_HEADER.length)]);
      },
    },

    priceObservations: {
      async readAll(): Promise<DecodeResult<PriceObservation>> {
        return readAllCached("PriceObservations", PRICE_OBSERVATIONS_HEADER, decodePriceObservation);
      },
      async append(observation: PriceObservation): Promise<void> {
        await ensureHeader(transport, "PriceObservations", PRICE_OBSERVATIONS_HEADER);
        await transport.appendRows("PriceObservations", [encodePriceObservation(observation)]);
        cache.invalidate("PriceObservations");
      },
    },
  };
}
