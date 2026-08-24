/**
 * Domain interfaces — WP-02.
 *
 * FROZEN: see src/domain/README.md. WP-10 implements SheetsTransport, WP-11
 * implements WorkbookStore, WP-17 implements SnapshotStore + Outbox. Six
 * interfaces plus the shared result/warning types every codec and sync path
 * returns. Changes only via a dedicated contract-change task approved by the
 * coordinator.
 *
 * Type-only imports from ./types (verbatimModuleSyntax) — this module adds
 * no new value exports of its own beyond the interfaces/types declared here.
 */
import type {
  Barcode,
  EventId,
  Ingredient,
  InventoryEvent,
  IsoDate,
  IsoTimestamp,
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
  Snapshot,
  WorkbookSheetName,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Shared warning / decode-result shapes (design requirement 10)
//
// A codec must skip a malformed row and surface a warning rather than throw
// (WP-11 BDD: "Malformed row does not break loading"). Every codec returns
// this same shape so callers get good rows and warnings together, instead of
// an exception that would take the whole sheet down with one bad cell.
// ---------------------------------------------------------------------------

export interface DataWarning {
  readonly sheet: WorkbookSheetName;
  /** 1-based row number as a human would see it in the sheet (header included in the count). */
  readonly row: number;
  readonly reason: string;
}

export interface DecodeResult<T> {
  readonly rows: readonly T[];
  readonly warnings: readonly DataWarning[];
}

// ---------------------------------------------------------------------------
// Sync outcome (design requirement 7)
//
// Cursor safety (invariant 2): a client whose cached generation mismatches
// Meta must discard its snapshot and re-read fully. Modelling that as a
// boolean flag lets a caller ignore it by accident (`if (ok) { ... }` and
// forget the `else`). A discriminated union forces every caller that wants
// the "applied" snapshot to also handle "reload-required" in the same
// switch/if-narrowing. WP-12 implements the function this describes.
// ---------------------------------------------------------------------------

export type SyncOutcome =
  | { readonly kind: "applied"; readonly snapshot: Snapshot }
  | { readonly kind: "reload-required"; readonly reason: string };

export type ApplyNewEvents = (
  snapshot: Snapshot,
  events: readonly InventoryEvent[],
  meta: Meta,
) => SyncOutcome;

// ---------------------------------------------------------------------------
// Clock & Rng (design requirement 6) — the only sources of nondeterminism.
// No domain module may call Date.now() or Math.random() directly; every
// engine takes these as injected dependencies instead.
// ---------------------------------------------------------------------------

export interface Clock {
  now(): IsoTimestamp;
  today(): IsoDate;
}

/** Seedable PRNG. `next()` returns a float in [0, 1), same contract as Math.random(). */
export interface Rng {
  next(): number;
}

// ---------------------------------------------------------------------------
// SheetsTransport (design requirement 9) — raw, range-based, entity-blind.
// WP-10 implements this over the Google Sheets REST API. Nothing here knows
// what a Recipe or an InventoryEvent is; that knowledge starts at WorkbookStore.
// ---------------------------------------------------------------------------

export type CellValue = string | number | boolean | null;
export type CellRow = readonly CellValue[];
export type CellGrid = readonly CellRow[];

/** A1 notation range, e.g. `"InventoryEvents!A2:H"`. */
export type A1Range = string;

export interface AppendResult {
  /** The A1 range the appended rows actually landed in (lets a caller learn the new row indices). */
  readonly updatedRange: A1Range;
}

export interface SheetsTransport {
  readRange(range: A1Range): Promise<CellGrid>;
  /** Batched ranged reads — one round trip for several ranges. */
  batchRead(ranges: readonly A1Range[]): Promise<readonly CellGrid[]>;
  appendRows(sheetName: WorkbookSheetName, rows: readonly CellRow[]): Promise<AppendResult>;
  updateRange(range: A1Range, rows: readonly CellRow[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// WorkbookStore (design requirement 9) — typed per-sheet access on top of a
// SheetsTransport. One nested namespace per sheet in DESIGN.md §3 (design
// requirement 13: all nine sheets represented). InventoryEvents is the only
// append-only sheet (invariant 1) — it is deliberately the only namespace
// without an `upsert`/edit method, only `append`.
// ---------------------------------------------------------------------------

export interface InventoryEventsPage extends DecodeResult<InventoryEvent> {
  /** Cursor to resume from on the next incremental read. */
  readonly nextCursor: number;
}

export interface WorkbookStore {
  readonly meta: {
    read(): Promise<Meta>;
    write(meta: Meta): Promise<void>;
  };
  readonly settings: {
    read(): Promise<Settings>;
    write(settings: Settings): Promise<void>;
  };
  readonly ingredients: {
    readAll(): Promise<DecodeResult<Ingredient>>;
    /** Insert-or-replace by `id`; last-write-wins (no locking, refresh-before-edit is the caller's job). */
    upsert(ingredient: Ingredient): Promise<void>;
  };
  readonly recipes: {
    readAll(): Promise<DecodeResult<Recipe>>;
    upsert(recipe: Recipe): Promise<void>;
  };
  readonly recipeIngredients: {
    readAll(): Promise<DecodeResult<RecipeIngredient>>;
    /** Replaces every ingredient line for one recipe (the join rows are owned by the recipe editor as a set). */
    replaceForRecipe(recipeId: RecipeId, lines: readonly RecipeIngredient[]): Promise<void>;
  };
  readonly recipeSteps: {
    readAll(): Promise<DecodeResult<RecipeStep>>;
    replaceForRecipe(recipeId: RecipeId, steps: readonly RecipeStep[]): Promise<void>;
  };
  readonly planSlots: {
    readAll(): Promise<DecodeResult<PlanSlot>>;
    upsert(slot: PlanSlot): Promise<void>;
  };
  readonly inventoryEvents: {
    /** Reads only rows at/after `cursor` — incremental sync never re-reads the whole log. */
    readFrom(cursor: number): Promise<InventoryEventsPage>;
    /**
     * Append-only (invariant 1: no update/delete method exists on this
     * namespace). Not required to dedupe by event id on its own — retry
     * idempotency is the Outbox/sync layer's responsibility (WP-17), built
     * on top of this plus `readFrom`.
     */
    append(event: InventoryEvent): Promise<void>;
  };
  readonly shoppingItems: {
    readAll(): Promise<DecodeResult<ShoppingItem>>;
    upsert(item: ShoppingItem): Promise<void>;
  };
  /** M6-A — DESIGN_PRODUCTS.md §2. `upsert` is insert-or-replace by `id`, same as `ingredients`/`recipes` above. WP-PRODUCTS-MODEL re-key: was keyed by `barcode` (the product's only identity at the time); see `Product.id`'s doc comment in types.ts and the `productBarcodes` namespace directly below for where the barcode(s) now live. */
  readonly products: {
    readAll(): Promise<DecodeResult<Product>>;
    upsert(product: Product): Promise<void>;
    /**
     * WP-products-screen: removes a product row outright — the merge
     * confirmation flow's completion step, called only after the loser's
     * barcodes and (transitively, via `ProductBarcodes`) its price history
     * have already been reassigned to the surviving product. Same "no
     * delete primitive, overwrite the row with blanks" treatment as
     * `photos.remove`/`productBarcodes.remove` (see
     * `src/sheets/workbook-store.ts`'s identical pattern there). Idempotent
     * if already removed. Never call this before the reassignment: an
     * interrupted merge must leave an orphaned-but-recoverable barcode
     * pointing at a product that still exists, not a barcode pointing at a
     * product that is already gone.
     */
    remove(productId: ProductId): Promise<void>;
  };
  /**
   * WP-PRODUCTS-MODEL re-key — DESIGN_PRODUCTS.md's `Product` gained its own
   * identity; this is the sheet that owns the set of barcodes a product is
   * sold under, one row per barcode (invariant 6 — never a delimited list in
   * a `Products` cell). `upsert` is insert-or-replace BY `barcode` — a
   * barcode belongs to exactly one product at a time, so reassigning one to
   * a different product (a confirmed merge, `src/domain/products.ts`'s
   * `planProductMerge`) overwrites its row instead of duplicating it.
   *
   * `remove` (WP-products-screen, the "genuine need" this namespace's
   * earlier doc comment anticipated): detaches a barcode with no
   * replacement — the products screen's own repair path for "I scanned the
   * wrong item and this barcode was never this product." Same "no delete
   * primitive, overwrite the row with blanks" treatment as `photos.remove`
   * (see `src/sheets/workbook-store.ts`'s identical pattern there) — never
   * confused with a merge, which reassigns rather than detaches.
   */
  readonly productBarcodes: {
    readAll(): Promise<DecodeResult<ProductBarcode>>;
    upsert(row: ProductBarcode): Promise<void>;
    remove(barcode: Barcode): Promise<void>;
  };
  /**
   * WP-PHOTO — DESIGN_PHOTOS.md §2/§6. One sheet for every photo-owning
   * entity (recipe / recipe-step / ingredient / product), keyed on
   * `(ownerKind, ownerId)`; supersedes M6-A's per-entity `productPhotos`
   * namespace.
   *
   * Deliberately **NO `readAll` here, and never add one**: reading this
   * sheet whole would pull every image in the workbook down the wire — the
   * entire reason photos live in their own sheet instead of a column on
   * their owner (a `Products`/`Recipes`/`Ingredients` listing would
   * otherwise drag every row's photo along on every load). A caller fetches
   * one photo, on demand, by key, only when it is actually displayed
   * (DESIGN_PHOTOS.md §2: "Access is by key, on demand, for the items
   * currently visible").
   */
  readonly photos: {
    get(ownerKind: PhotoOwnerKind, ownerId: PhotoOwnerId): Promise<Photo | undefined>;
    /** Insert-or-replace by `(ownerKind, ownerId)`; last-write-wins, same as every other `upsert` here. */
    upsert(photo: Photo): Promise<void>;
    remove(ownerKind: PhotoOwnerKind, ownerId: PhotoOwnerId): Promise<void>;
  };
  /**
   * M6-A — DESIGN_PRODUCTS.md §2. Append-only like `inventoryEvents` above
   * (no update/delete method exists on this namespace): a price observation
   * is a point-in-time fact, and corrections are new rows, not edits.
   * `readAll` rather than a cursor-paged `readFrom`, unlike
   * `inventoryEvents`: nothing in M6-A folds this incrementally into a
   * client-side snapshot (that is future work, not part of this contract
   * change), so there is no cursor to resume from yet. A future work
   * package that needs incremental reads can add a `readFrom` method here
   * without touching this one (additive, same pattern as
   * `InventoryEventsPage` above).
   */
  readonly priceObservations: {
    readAll(): Promise<DecodeResult<PriceObservation>>;
    append(observation: PriceObservation): Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// SnapshotStore (design requirement 8) — localStorage-backed cache of the
// folded inventory (invariant 5: Sheets is the source of truth, localStorage
// is a cache — SnapshotStore only ever holds what WorkbookStore could
// reconstruct from the workbook).
// ---------------------------------------------------------------------------

export interface SnapshotStore {
  load(workbookId: string): Promise<Snapshot | undefined>;
  save(workbookId: string, snapshot: Snapshot): Promise<void>;
  clear(workbookId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Outbox (design requirement 11 / invariant 9) — offline writes are events
// appended via the outbox, never queued in-place edits. This queue only ever
// holds InventoryEvents; plain-row edits (recipes, settings, plan slots) use
// a separate last-write-wins refresh-before-edit path (WP-17), not the
// outbox, because they are not append-only by nature.
// ---------------------------------------------------------------------------

export interface Outbox {
  /** Idempotent by the event's own id: enqueueing the same EventId twice keeps one entry. */
  enqueue(event: InventoryEvent): Promise<void>;
  /** Pending entries in enqueue (FIFO) order. */
  pending(): Promise<readonly InventoryEvent[]>;
  /** Removes an entry after a successful flush; idempotent if already removed. */
  acknowledge(eventId: EventId): Promise<void>;
  clear(): Promise<void>;
}
