/**
 * The scan route's data/sync container (M6 — DESIGN_PRODUCTS.md §1). Mirrors
 * `usePantryInventory.ts`/`useShoppingList.ts`'s own boot/sync/submit shape
 * (same per-route `Outbox`/`SnapshotStore`/connectivity/controller instance
 * — see those files' header comments for why each route rolls its own
 * rather than sharing one) rather than importing either of those hooks,
 * which are private to their own route packages (same boundary
 * `checkoff-options.ts` already draws between Pantry and Shopping).
 *
 * Two kinds of write, per HANDOVER.md invariant 9 and the coordinator's
 * additional-requirement note (need/buy/surplus, DESIGN_PURCHASING.md §2):
 *
 *  - A scanned ingredient that has a live shopping need for "this week"
 *    reuses the EXACT SAME seam the Shopping route's own check-off uses —
 *    `checkOffShoppingItem` (WP-14) building a `PurchaseEvent`, enqueued via
 *    the outbox, plus a plain `ShoppingItems` upsert recording
 *    `neededQuantity`/`boughtQuantity` — so a scan-based "bought more than
 *    the list asked for" shows up identically to a manual check-off's
 *    surplus (never a warning colour, DESIGN_PURCHASING.md §2/§6).
 *  - A scanned ingredient with no live need is a bare pantry restock
 *    (`buildPurchaseEvent`, same as Pantry's own "Already in my pantry"
 *    add-lot form) — there is no `ShoppingItems` row to touch.
 *
 * `shoppingNeedByIngredient` is this week's live need (needs minus viable
 * stock, WP-14's full engine) — the "list ask" `recordPurchase` defaults
 * the buy amount to (requirement 1: "default to the amount the list asked
 * for"). This is intentionally a fixed 7-day "this week" window rather than
 * whatever range the Shopping screen currently happens to be showing (that
 * range is Shopping.tsx-local UI state, not something this route reaches
 * into) — see this file's own `THIS_WEEK_DAYS` constant.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkbookContext } from "../../workbook-context.ts";
import { useToast } from "../../ui/components/Toast/useToast.ts";
import {
  addDays,
  buildPriceObservation,
  buildPurchaseEvent,
  checkOffShoppingItem,
  computeShoppingList,
  createApplyNewEvents,
  newProductId,
  resolveProductId,
} from "../../domain/index.ts";
import type {
  ApplyNewEvents,
  Barcode,
  DataWarning,
  Ingredient,
  IngredientId,
  InventoryEvent,
  IsoDate,
  Lot,
  Meta,
  Outbox,
  PhotoOwnerKind,
  PlanSlot,
  PriceObservation,
  Product,
  ProductBarcode,
  ProductId,
  Quantity,
  Recipe,
  RecipeIngredient,
  Settings,
  ShoppingItem,
  ShoppingListLine,
  Snapshot,
  StorageLocation,
} from "../../domain/index.ts";
import {
  acquireSharedOutboxSync,
  createLocalStorageSnapshotStore,
  previewSnapshotWithPending,
  syncSnapshot,
} from "../../sync/index.ts";
import type { OutboxSyncController } from "../../sync/index.ts";
import { describeError as messageOf } from "../../sheets/error-messages.ts";

/** A fixed 7-day "this week" window — see the module doc comment for why it's not Shopping.tsx's own current range. */
const THIS_WEEK_DAYS = 6;

interface Engine {
  readonly outbox: Outbox;
  readonly applyNewEvents: ApplyNewEvents;
  readonly controller: OutboxSyncController;
}

export interface RecordPurchaseInput {
  readonly ingredientId: IngredientId;
  /** The confirmed "buy" amount (DESIGN_PURCHASING.md §2) — defaults to the shopping need, or the product's package size, but always the human's final say. */
  readonly buyQuantity: Quantity;
  readonly location: StorageLocation;
  readonly purchaseDate: IsoDate;
  readonly expiryOverride?: IsoDate;
}

export interface RecordPriceInput {
  readonly ingredientId: IngredientId;
  readonly barcode?: Barcode;
  readonly quantity: Quantity;
  readonly price: number;
  readonly source?: string;
}

/**
 * WP-stale-save: `saveProduct` only ever runs for a barcode THIS device
 * scanned as unrecognised (`Scan.tsx`'s `phase: "new"`) — see that
 * function's own doc comment. `"conflict"` means the barcode was created
 * by someone else in the interval between this device's scan and its save
 * — `existing` is the row Sheets already has, so the caller can switch to
 * the normal known-product flow against it instead of overwriting it.
 */
export type SaveProductResult = { readonly status: "created"; readonly product: Product } | { readonly status: "conflict"; readonly existing: Product };

/**
 * WP-PRODUCTS-MODEL: what `ProductEditorPanel` collects for a brand-new
 * product does not yet include an `id` — a `Product`'s identity is minted
 * here, at save time, from the injected `Rng` (`newProductId`), same as
 * every other client-minted id in this codebase. `barcode` is passed
 * alongside because it is no longer a field on `Product` itself; saving
 * writes both the `Products` row and the `ProductBarcodes` row that links
 * the two.
 */
export type NewProductInput = Omit<Product, "id">;

export interface ScanFlow {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly warnings: readonly DataWarning[];
  readonly today: IsoDate;
  readonly ingredients: readonly Ingredient[];
  readonly ingredientsById: ReadonlyMap<IngredientId, Ingredient>;
  readonly productsByBarcode: ReadonlyMap<Barcode, Product>;
  readonly settings: Settings | undefined;
  readonly currencySymbol: string;
  /** This week's live shopping need, keyed by ingredient — see the module doc comment. */
  readonly shoppingNeedByIngredient: ReadonlyMap<IngredientId, ShoppingListLine>;
  /** Distinct `source` values already recorded on any past price observation, most-recently-seen first — see `RecordPriceInput.source`'s doc comment and the shopping route's identical field. */
  readonly previousSources: readonly string[];
  readonly retry: () => void;
  readonly saveProduct: (product: NewProductInput, barcode: Barcode) => Promise<SaveProductResult>;
  readonly savePhoto: (ownerKind: PhotoOwnerKind, ownerId: ProductId, dataUrl: string) => Promise<void>;
  readonly recordPurchase: (input: RecordPurchaseInput) => Promise<void>;
  readonly recordPrice: (input: RecordPriceInput) => Promise<void>;
}

export function useScanFlow(): ScanFlow {
  const { store, clock, rng, workbookId } = useWorkbookContext();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [warnings, setWarnings] = useState<readonly DataWarning[]>([]);
  const [ingredients, setIngredients] = useState<readonly Ingredient[]>([]);
  const [products, setProducts] = useState<readonly Product[]>([]);
  const [productBarcodes, setProductBarcodes] = useState<readonly ProductBarcode[]>([]);
  const [priceObservations, setPriceObservations] = useState<readonly PriceObservation[]>([]);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [recipeIngredients, setRecipeIngredients] = useState<readonly RecipeIngredient[]>([]);
  const [planSlots, setPlanSlots] = useState<readonly PlanSlot[]>([]);
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  // WP-stale-save: this hook's own already-synced snapshot of `ShoppingItems`
  // — see `recordPurchase`'s doc comment for why. Read at boot/refresh, same
  // cadence as `useShoppingList.ts`'s own `shoppingItems` state, never a
  // live read at write time (this is the same in-store, one-handed path
  // UI_DESIGN.md §1 invariant 5 covers for manual check-off).
  const [shoppingItems, setShoppingItems] = useState<readonly ShoppingItem[]>([]);
  const [confirmed, setConfirmed] = useState<Snapshot | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [pending, setPending] = useState<readonly InventoryEvent[]>([]);
  const [engine, setEngine] = useState<Engine | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (!engine) return;
    const snapshotStore = createLocalStorageSnapshotStore();
    const [nextConfirmed, nextMeta, nextPending, shoppingItemsResult] = await Promise.all([
      syncSnapshot({ workbookStore: store, snapshotStore, applyNewEvents: engine.applyNewEvents }, workbookId),
      store.meta.read(),
      engine.outbox.pending(),
      store.shoppingItems.readAll(),
    ]);
    setConfirmed(nextConfirmed);
    setMeta(nextMeta);
    setPending(nextPending);
    setShoppingItems(shoppingItemsResult.rows);
  }, [engine, store, workbookId]);

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    // loading/error/engine are only ever set from boot()'s own resolution
    // (react-hooks set-state-in-effect rule), same discipline as
    // usePantryInventory.ts/useShoppingList.ts.
    let cancelled = false;
    let releaseSharedSync: (() => void) | undefined;

    async function boot(): Promise<void> {
      const [
        ingredientsResult,
        productsResult,
        productBarcodesResult,
        recipesResult,
        recipeIngredientsResult,
        planSlotsResult,
        settingsResult,
        shoppingItemsResult,
        priceObservationsResult,
      ] = await Promise.all([
        store.ingredients.readAll(),
        store.products.readAll(),
        store.productBarcodes.readAll(),
        store.recipes.readAll(),
        store.recipeIngredients.readAll(),
        store.planSlots.readAll(),
        store.settings.read(),
        store.shoppingItems.readAll(),
        store.priceObservations.readAll(),
      ]);
      if (cancelled) return;

      setError(undefined);
      setIngredients(ingredientsResult.rows);
      setProducts(productsResult.rows);
      setProductBarcodes(productBarcodesResult.rows);
      setRecipes(recipesResult.rows);
      setRecipeIngredients(recipeIngredientsResult.rows);
      setPlanSlots(planSlotsResult.rows);
      setSettings(settingsResult);
      setShoppingItems(shoppingItemsResult.rows);
      setPriceObservations(priceObservationsResult.rows);

      const allWarnings = [
        ...ingredientsResult.warnings,
        ...productsResult.warnings,
        ...recipesResult.warnings,
        ...recipeIngredientsResult.warnings,
        ...planSlotsResult.warnings,
      ];
      setWarnings(allWarnings);
      const first = allWarnings[0];
      if (first) {
        showToast({
          variant: "warning",
          title: `${allWarnings.length} row${allWarnings.length === 1 ? "" : "s"} skipped`,
          description: first.reason,
        });
      }

      const catalog = new Map(ingredientsResult.rows.map((ingredient) => [ingredient.id, ingredient] as const));
      const applyNewEvents = createApplyNewEvents(catalog);
      const snapshotStore = createLocalStorageSnapshotStore();
      // The shared, app-wide Outbox + OutboxSyncController for this workbook
      // (src/sync/outbox-registry.ts) — see usePantryInventory.ts's boot()
      // for the full rationale; this hook used to build its own private
      // controller, which is exactly what let the same InventoryEvent be
      // appended twice after an offline→online transition.
      const sharedSync = acquireSharedOutboxSync({
        workbookId,
        workbookStore: store,
        onResult: (result) => {
          if (result.failure) {
            showToast({
              variant: "error",
              title: "A pantry change couldn't sync",
              description: messageOf(result.failure.error),
            });
          }
          void refreshRef.current();
        },
      });
      const { outbox } = sharedSync;
      releaseSharedSync = sharedSync.release;

      const [nextConfirmed, nextMeta, nextPending] = await Promise.all([
        syncSnapshot({ workbookStore: store, snapshotStore, applyNewEvents }, workbookId),
        store.meta.read(),
        outbox.pending(),
      ]);
      if (cancelled) return;

      setConfirmed(nextConfirmed);
      setMeta(nextMeta);
      setPending(nextPending);
      setEngine({ outbox, applyNewEvents, controller: sharedSync.controller });
      setLoading(false);
    }

    boot().catch((err: unknown) => {
      if (!cancelled) {
        setError(messageOf(err));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      releaseSharedSync?.();
    };
  }, [store, workbookId, reloadToken, showToast]);

  const lots = useMemo<readonly Lot[]>(() => {
    if (!confirmed || !meta || !engine) return [];
    return previewSnapshotWithPending(confirmed, pending, meta, engine.applyNewEvents).lots;
  }, [confirmed, meta, pending, engine]);

  const ingredientsById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient] as const)),
    [ingredients],
  );

  // WP-PRODUCTS-MODEL: a `Product` no longer carries its own barcode(s) —
  // this join over `ProductBarcodes` reconstructs the same barcode-keyed
  // view every caller in this route already expects, so `Scan.tsx`'s
  // "known barcode -> product" lookup needed no reshaping.
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product] as const)), [products]);
  const productsByBarcode = useMemo(() => {
    const map = new Map<Barcode, Product>();
    for (const row of productBarcodes) {
      const product = productsById.get(row.productId);
      if (product) map.set(row.barcode, product);
    }
    return map;
  }, [productBarcodes, productsById]);

  const today = clock.today();

  const shoppingNeedByIngredient = useMemo<ReadonlyMap<IngredientId, ShoppingListLine>>(() => {
    if (!settings) return new Map();
    const range = { start: today, end: addDays(today, THIS_WEEK_DAYS) };
    const lines = computeShoppingList({ range, planSlots, recipes, recipeIngredients, settings, lots });
    return new Map(lines.map((line) => [line.ingredientId, line] as const));
  }, [settings, today, planSlots, recipes, recipeIngredients, lots]);

  const currencySymbol = settings?.currency ?? "$";

  /**
   * WP-stale-save: this only ever creates a product THIS device believed
   * was unrecognised — there is no prior row this device loaded and is now
   * editing (the recipe/ingredient forms' "re-read, compare,
   * ConfirmDialog" shape doesn't apply — nothing here is stale by that
   * definition). The real, narrower risk: two people scanning the SAME
   * unknown barcode around the same time would each mint a DIFFERENT
   * product definition for it, and `products.upsert` (insert-or-replace by
   * barcode, contracts.ts) would let whichever write lands last silently
   * overwrite the other's choice of name/ingredient/package size with no
   * warning. This re-read (once, on a multi-field form submit — not a
   * one-handed tap, so not the invariant-5 latency concern the shopping/
   * scan check-off paths are) catches that: if the barcode already exists
   * by the time of this save, this does NOT overwrite it — it reports the
   * conflict so the caller can fall back to the normal known-product flow
   * against whichever definition Sheets already has.
   */
  const saveProduct = useCallback(
    async (input: NewProductInput, barcode: Barcode): Promise<SaveProductResult> => {
      const [latestProducts, latestBarcodes] = await Promise.all([store.products.readAll(), store.productBarcodes.readAll()]);
      const existingProductId = resolveProductId(barcode, latestBarcodes.rows);
      if (existingProductId) {
        const existing = latestProducts.rows.find((p) => p.id === existingProductId);
        if (existing) {
          setProducts((current) => [...current.filter((p) => p.id !== existing.id), existing]);
          setProductBarcodes(latestBarcodes.rows);
          return { status: "conflict", existing };
        }
      }
      const product: Product = { ...input, id: newProductId(rng) };
      await store.products.upsert(product);
      const barcodeRow: ProductBarcode = { productId: product.id, barcode };
      await store.productBarcodes.upsert(barcodeRow);
      setProducts((current) => [...current.filter((p) => p.id !== product.id), product]);
      setProductBarcodes((current) => [...current.filter((row) => row.barcode !== barcode), barcodeRow]);
      return { status: "created", product };
    },
    [store, rng],
  );

  // WP-stale-save: no stale-save protection here — a `Photo` row IS the
  // image (`ownerKind`/`ownerId`/`dataUrl`/`updatedAt`, contracts.ts), no
  // adjacent field a concurrent write could clobber, so last-write-wins is
  // simply "whichever photo was saved last shows" — the same reasoning
  // `photo-save.ts`'s `applyPhotoDraft` documents for the recipe/ingredient
  // photo forms.
  const savePhoto = useCallback(
    async (ownerKind: PhotoOwnerKind, ownerId: ProductId, dataUrl: string): Promise<void> => {
      await store.photos.upsert({ ownerKind, ownerId, dataUrl, updatedAt: clock.now() });
    },
    [store, clock],
  );

  // WP-stale-save: same deliberate "merge onto the already-synced local
  // snapshot, no live re-read" shape as `useShoppingList.ts`'s own
  // `persistShoppingItem` — see that hook's doc comment for the full
  // UI_DESIGN.md §1 invariant 5 reasoning (scan-and-buy is the same
  // in-store, one-handed, bad-connection path as manual check-off).
  const persistShoppingItem = useCallback(
    async (item: ShoppingItem): Promise<void> => {
      setShoppingItems((current) => [
        ...current.filter(
          (existing) =>
            !(
              existing.ingredientId === item.ingredientId &&
              existing.rangeStart === item.rangeStart &&
              existing.rangeEnd === item.rangeEnd
            ),
        ),
        item,
      ]);
      try {
        await store.shoppingItems.upsert(item);
      } catch (err) {
        showToast({ variant: "error", title: "Couldn't save the checked state", description: messageOf(err) });
      }
    },
    [store, showToast],
  );

  const recordPurchase = useCallback(
    async (input: RecordPurchaseInput): Promise<void> => {
      if (!engine) return;
      const need = shoppingNeedByIngredient.get(input.ingredientId);

      const event = need
        ? checkOffShoppingItem(
            {
              ingredientId: input.ingredientId,
              neededQuantity: need.neededQuantity,
              actualQuantity: input.buyQuantity,
              location: input.location,
              ...(input.expiryOverride !== undefined ? { expiryOverride: input.expiryOverride } : {}),
            },
            clock,
            rng,
          )
        : buildPurchaseEvent(
            {
              ingredientId: input.ingredientId,
              quantity: input.buyQuantity,
              location: input.location,
              purchaseDate: input.purchaseDate,
              ...(input.expiryOverride !== undefined ? { expiryOverride: input.expiryOverride } : {}),
            },
            clock,
            rng,
          );

      setPending((current) => [...current, event]);
      try {
        await engine.outbox.enqueue(event);
      } catch (err) {
        setPending((current) => current.filter((e) => e.id !== event.id));
        showToast({ variant: "error", title: "Couldn't save the purchase", description: messageOf(err) });
        return;
      }
      showToast({ variant: "success", title: "Added to pantry.", durationMs: 3000 });
      void engine.controller.flushNow();

      if (need) {
        // WP-stale-save: `need` (this week's ENGINE-computed shopping line)
        // never carries a `purchaseOverride` — only `withPurchaseOverride`
        // (called by `useShoppingList.ts`, not this hook) merges one onto
        // an engine line. Writing straight from `need` alone used to
        // silently ERASE whatever `purchaseOverride`/`suggestedPurchase`
        // the ALREADY-PERSISTED `ShoppingItems` row for this ingredient +
        // range had (DESIGN_PURCHASING.md §7: `purchaseOverride` is
        // specifically meant to "survive a plan recompute" — a scan is not
        // a recompute either), because this is a full-row upsert
        // (contracts.ts) with no partial-field update. `existingItem` is
        // this hook's own already-synced local snapshot of that row
        // (`shoppingItems` state, above) — merging onto it, not a fresh
        // read, keeps this exact same non-blocking shape check-off itself
        // uses (see `persistShoppingItem`'s doc comment).
        const existingItem = shoppingItems.find(
          (item) =>
            item.ingredientId === need.ingredientId &&
            item.rangeStart === need.rangeStart &&
            item.rangeEnd === need.rangeEnd,
        );
        const suggestedPurchase = need.suggestedPurchase ?? existingItem?.suggestedPurchase;
        const purchaseOverride = existingItem?.purchaseOverride;
        await persistShoppingItem({
          ingredientId: need.ingredientId,
          rangeStart: need.rangeStart,
          rangeEnd: need.rangeEnd,
          neededQuantity: need.neededQuantity,
          checked: true,
          boughtQuantity: input.buyQuantity,
          ...(suggestedPurchase !== undefined ? { suggestedPurchase } : {}),
          ...(purchaseOverride !== undefined ? { purchaseOverride } : {}),
        });
      }
    },
    [engine, shoppingNeedByIngredient, shoppingItems, clock, rng, showToast, persistShoppingItem],
  );

  const recordPrice = useCallback(
    async (input: RecordPriceInput): Promise<void> => {
      try {
        const observation = buildPriceObservation(
          {
            ingredientId: input.ingredientId,
            quantity: input.quantity,
            price: input.price,
            ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
            ...(input.source !== undefined ? { source: input.source } : {}),
          },
          clock,
          rng,
        );
        await store.priceObservations.append(observation);
        setPriceObservations((current) => [...current, observation]);
      } catch (err) {
        showToast({ variant: "error", title: "Couldn't save the price", description: messageOf(err) });
      }
    },
    [store, clock, rng, showToast],
  );

  const previousSources = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (let i = priceObservations.length - 1; i >= 0; i -= 1) {
      const source = priceObservations[i]?.source;
      if (source === undefined || source.trim() === "" || seen.has(source)) continue;
      seen.add(source);
      ordered.push(source);
    }
    return ordered;
  }, [priceObservations]);

  const retry = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  return {
    loading,
    error,
    warnings,
    today,
    ingredients,
    ingredientsById,
    productsByBarcode,
    settings,
    currencySymbol,
    shoppingNeedByIngredient,
    previousSources,
    retry,
    saveProduct,
    savePhoto,
    recordPurchase,
    recordPrice,
  };
}
