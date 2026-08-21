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
  Product,
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
  createBrowserConnectivityMonitor,
  createLocalStorageOutbox,
  createLocalStorageSnapshotStore,
  createOutboxSyncController,
  previewSnapshotWithPending,
  syncSnapshot,
} from "../../sync/index.ts";
import type { OutboxSyncController } from "../../sync/index.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
  readonly retry: () => void;
  readonly saveProduct: (product: Product) => Promise<void>;
  readonly savePhoto: (ownerKind: PhotoOwnerKind, ownerId: Barcode, dataUrl: string) => Promise<void>;
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
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [recipeIngredients, setRecipeIngredients] = useState<readonly RecipeIngredient[]>([]);
  const [planSlots, setPlanSlots] = useState<readonly PlanSlot[]>([]);
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [confirmed, setConfirmed] = useState<Snapshot | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [pending, setPending] = useState<readonly InventoryEvent[]>([]);
  const [engine, setEngine] = useState<Engine | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (!engine) return;
    const snapshotStore = createLocalStorageSnapshotStore();
    const [nextConfirmed, nextMeta, nextPending] = await Promise.all([
      syncSnapshot({ workbookStore: store, snapshotStore, applyNewEvents: engine.applyNewEvents }, workbookId),
      store.meta.read(),
      engine.outbox.pending(),
    ]);
    setConfirmed(nextConfirmed);
    setMeta(nextMeta);
    setPending(nextPending);
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
    let stopController: (() => void) | undefined;

    async function boot(): Promise<void> {
      const [ingredientsResult, productsResult, recipesResult, recipeIngredientsResult, planSlotsResult, settingsResult] =
        await Promise.all([
          store.ingredients.readAll(),
          store.products.readAll(),
          store.recipes.readAll(),
          store.recipeIngredients.readAll(),
          store.planSlots.readAll(),
          store.settings.read(),
        ]);
      if (cancelled) return;

      setError(undefined);
      setIngredients(ingredientsResult.rows);
      setProducts(productsResult.rows);
      setRecipes(recipesResult.rows);
      setRecipeIngredients(recipeIngredientsResult.rows);
      setPlanSlots(planSlotsResult.rows);
      setSettings(settingsResult);

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
      const outbox = createLocalStorageOutbox(workbookId);
      const connectivity = createBrowserConnectivityMonitor();
      const controller = createOutboxSyncController({
        outbox,
        workbookStore: store,
        connectivity,
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

      const [nextConfirmed, nextMeta, nextPending] = await Promise.all([
        syncSnapshot({ workbookStore: store, snapshotStore, applyNewEvents }, workbookId),
        store.meta.read(),
        outbox.pending(),
      ]);
      if (cancelled) return;

      setConfirmed(nextConfirmed);
      setMeta(nextMeta);
      setPending(nextPending);
      setEngine({ outbox, applyNewEvents, controller });
      setLoading(false);
      stopController = controller.start();
    }

    boot().catch((err: unknown) => {
      if (!cancelled) {
        setError(messageOf(err));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      stopController?.();
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

  const productsByBarcode = useMemo(
    () => new Map(products.map((product) => [product.barcode, product] as const)),
    [products],
  );

  const today = clock.today();

  const shoppingNeedByIngredient = useMemo<ReadonlyMap<IngredientId, ShoppingListLine>>(() => {
    if (!settings) return new Map();
    const range = { start: today, end: addDays(today, THIS_WEEK_DAYS) };
    const lines = computeShoppingList({ range, planSlots, recipes, recipeIngredients, settings, lots });
    return new Map(lines.map((line) => [line.ingredientId, line] as const));
  }, [settings, today, planSlots, recipes, recipeIngredients, lots]);

  const currencySymbol = settings?.currency ?? "$";

  const saveProduct = useCallback(
    async (product: Product): Promise<void> => {
      await store.products.upsert(product);
      setProducts((current) => [...current.filter((p) => p.barcode !== product.barcode), product]);
    },
    [store],
  );

  const savePhoto = useCallback(
    async (ownerKind: PhotoOwnerKind, ownerId: Barcode, dataUrl: string): Promise<void> => {
      await store.photos.upsert({ ownerKind, ownerId, dataUrl, updatedAt: clock.now() });
    },
    [store, clock],
  );

  const persistShoppingItem = useCallback(
    async (item: ShoppingItem): Promise<void> => {
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
        await persistShoppingItem({
          ingredientId: need.ingredientId,
          rangeStart: need.rangeStart,
          rangeEnd: need.rangeEnd,
          neededQuantity: need.neededQuantity,
          checked: true,
          boughtQuantity: input.buyQuantity,
        });
      }
    },
    [engine, shoppingNeedByIngredient, clock, rng, showToast, persistShoppingItem],
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
      } catch (err) {
        showToast({ variant: "error", title: "Couldn't save the price", description: messageOf(err) });
      }
    },
    [store, clock, rng, showToast],
  );

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
    retry,
    saveProduct,
    savePhoto,
    recordPurchase,
    recordPrice,
  };
}
