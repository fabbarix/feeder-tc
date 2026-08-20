/**
 * Owns the Shopping route's data: the range-scoped generated list
 * (WP-14's `computeShoppingList`/`computeNeeds`), live-recomputed as the
 * plan or pantry changes, plus check-off. Mirrors WP-21's
 * `usePantryInventory` container pattern (same boot/refresh/submit shape,
 * same per-route `Outbox`/`SnapshotStore`/connectivity/controller
 * instance) — see that file's header comment for why each route rolls its
 * own sync engine rather than sharing one.
 *
 * Two kinds of write, per HANDOVER.md invariant 9 / UI_DESIGN.md §7:
 *
 *  - Check-off builds a `PurchaseEvent` (`checkOffShoppingItem`, WP-14) and
 *    enqueues it via the `Outbox` — never a direct `inventoryEvents.append`.
 *    This is the robust, offline-safe path; a genuine flush failure sets
 *    `failedCheckoff` so the row can show `CheckRow`'s `failed` state with a
 *    retry (UI_DESIGN.md §8), exactly like `usePantryInventory`'s
 *    `failedLot`.
 *  - The persisted `checked`/`boughtQuantity` flag (`ShoppingItems`, keyed
 *    by ingredient + range) is a *plain row* (HANDOVER's decision register:
 *    "everything else plain rows"), not an event — `Outbox` is typed to
 *    `InventoryEvent` only (contracts.ts) and cannot carry it. This is a
 *    direct, best-effort `WorkbookStore.shoppingItems.upsert` write
 *    (optimistic locally first), matching how Settings/RecipeEditor write
 *    their own plain rows elsewhere in the app. A failure here is toasted,
 *    not shown as a row-level `failed` badge — that badge is reserved for
 *    the sync-layer meaning UI_DESIGN.md §8 gives it (a genuinely failed
 *    outbox flush), and conflating the two would make "failed" mean two
 *    different things on the same row.
 *
 * "Already-bought items stay checked" (DESIGN.md §2) vs. "recomputed live
 * as the plan changes": checking off a line that was the ONLY shortfall for
 * its ingredient makes that ingredient fully covered, so `computeShoppingList`
 * correctly stops returning a line for it on the next recompute — but doing
 * that recompute the INSTANT the checkbox is ticked would make the row
 * vanish before the user ever sees it marked bought, which is what "stay
 * checked" is guarding against. `stickyLines` below is the fix: a line the
 * user just checked off stays rendered (checked, struck through) for the
 * rest of THIS mounted session even once the engine stops returning it,
 * using the snapshot of the line as it was at check-off time. It resets on
 * the next real remount/reload — a genuinely fresh list — which is exactly
 * the mandatory BDD scenario's last step, "regenerating the list shows no
 * rice line".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkbookContext } from "../../workbook-context.ts";
import { useToast } from "../../ui/components/Toast/useToast.ts";
import {
  checkOffShoppingItem,
  computeNeeds,
  computeShoppingList,
  createApplyNewEvents,
} from "../../domain/index.ts";
import type {
  ApplyNewEvents,
  DataWarning,
  DateRange,
  EventId,
  Ingredient,
  IngredientId,
  InventoryEvent,
  IsoDate,
  Lot,
  Meta,
  Outbox,
  PlanSlot,
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
import type { FlushOutboxResult, OutboxSyncController } from "../../sync/index.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function shoppingItemKey(ingredientId: IngredientId, rangeStart: IsoDate, rangeEnd: IsoDate): string {
  return `${ingredientId}__${rangeStart}__${rangeEnd}`;
}

function keyForItem(item: ShoppingItem): string {
  return shoppingItemKey(item.ingredientId, item.rangeStart, item.rangeEnd);
}

function keyForLine(line: ShoppingListLine): string {
  return shoppingItemKey(line.ingredientId, line.rangeStart, line.rangeEnd);
}

interface Engine {
  readonly outbox: Outbox;
  readonly applyNewEvents: ApplyNewEvents;
  readonly controller: OutboxSyncController;
}

/** Set only after a flush genuinely fails — see the module doc comment. */
interface FailedCheckoff {
  readonly eventId: EventId;
  readonly ingredientId: IngredientId;
}

export interface CheckOffInput {
  readonly actualQuantity?: Quantity;
  readonly location: StorageLocation;
  readonly expiryOverride?: IsoDate;
}

export interface ShoppingListState {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly warnings: readonly DataWarning[];
  readonly ingredientsById: ReadonlyMap<IngredientId, Ingredient>;
  readonly recipes: readonly Recipe[];
  readonly recipeIngredients: readonly RecipeIngredient[];
  readonly planSlots: readonly PlanSlot[];
  readonly settings: Settings | undefined;
  /** This range's generated list — needs minus viable stock, live-recomputed from `planSlots`/`lots`. */
  readonly lines: readonly ShoppingListLine[];
  /** Distinct ingredients needed in range at all, covered or not — `lines.length` of these still need buying (the rail's "N covered by the pantry" stat). */
  readonly totalNeededIngredientCount: number;
  /** Checked/bought state for lines in the CURRENT range, keyed by ingredient — DESIGN.md "already-bought items stay checked". */
  readonly checkedByIngredient: ReadonlyMap<IngredientId, ShoppingItem>;
  readonly failedCheckoff: FailedCheckoff | undefined;
  readonly retry: () => void;
  readonly retryFlush: () => void;
  readonly checkOff: (line: ShoppingListLine, input: CheckOffInput) => Promise<void>;
  readonly uncheck: (line: ShoppingListLine) => Promise<void>;
}

const EMPTY_LOTS: readonly Lot[] = [];

export function useShoppingList(range: DateRange): ShoppingListState {
  const { store, clock, rng, workbookId } = useWorkbookContext();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [warnings, setWarnings] = useState<readonly DataWarning[]>([]);
  const [ingredients, setIngredients] = useState<readonly Ingredient[]>([]);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [recipeIngredients, setRecipeIngredients] = useState<readonly RecipeIngredient[]>([]);
  const [planSlots, setPlanSlots] = useState<readonly PlanSlot[]>([]);
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [shoppingItems, setShoppingItems] = useState<readonly ShoppingItem[]>([]);
  const [confirmed, setConfirmed] = useState<Snapshot | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [pending, setPending] = useState<readonly InventoryEvent[]>([]);
  const [failedCheckoff, setFailedCheckoff] = useState<FailedCheckoff | undefined>(undefined);
  const [engine, setEngine] = useState<Engine | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);
  // Session-scoped only (see the module doc comment) — deliberately not
  // loaded from/persisted to anything, and never reset except by unmount.
  const [stickyLines, setStickyLines] = useState<ReadonlyMap<string, ShoppingListLine>>(new Map());

  const refresh = useCallback(async (): Promise<void> => {
    if (!engine) return;
    const snapshotStore = createLocalStorageSnapshotStore();
    const [nextConfirmed, nextMeta, nextPending, planSlotsResult, shoppingItemsResult] = await Promise.all([
      syncSnapshot({ workbookStore: store, snapshotStore, applyNewEvents: engine.applyNewEvents }, workbookId),
      store.meta.read(),
      engine.outbox.pending(),
      store.planSlots.readAll(),
      store.shoppingItems.readAll(),
    ]);
    setConfirmed(nextConfirmed);
    setMeta(nextMeta);
    setPending(nextPending);
    setPlanSlots(planSlotsResult.rows);
    setShoppingItems(shoppingItemsResult.rows);
  }, [engine, store, workbookId]);

  const handleFlushResult = useCallback(
    (result: FlushOutboxResult) => {
      const failure = result.failure;
      if (failure) {
        const event = pending.find((e) => e.id === failure.eventId);
        const ingredientId = event && "ingredientId" in event ? event.ingredientId : undefined;
        if (ingredientId) setFailedCheckoff({ eventId: failure.eventId, ingredientId });
        showToast({
          variant: "error",
          title: "A check-off couldn't sync",
          description: messageOf(failure.error),
        });
      } else {
        setFailedCheckoff(undefined);
      }
      void refresh();
    },
    [pending, refresh, showToast],
  );
  const handleFlushResultRef = useRef(handleFlushResult);
  useEffect(() => {
    handleFlushResultRef.current = handleFlushResult;
  }, [handleFlushResult]);

  useEffect(() => {
    // loading/error/engine only ever set from boot()'s own resolution
    // (react-hooks set-state-in-effect rule) — same discipline as
    // usePantryInventory.
    let cancelled = false;
    let stopController: (() => void) | undefined;

    async function boot(): Promise<void> {
      const [ingredientsResult, recipesResult, recipeIngredientsResult, planSlotsResult, settingsResult, shoppingItemsResult] =
        await Promise.all([
          store.ingredients.readAll(),
          store.recipes.readAll(),
          store.recipeIngredients.readAll(),
          store.planSlots.readAll(),
          store.settings.read(),
          store.shoppingItems.readAll(),
        ]);
      if (cancelled) return;

      setError(undefined);
      setFailedCheckoff(undefined);
      setIngredients(ingredientsResult.rows);
      setRecipes(recipesResult.rows);
      setRecipeIngredients(recipeIngredientsResult.rows);
      setPlanSlots(planSlotsResult.rows);
      setSettings(settingsResult);
      setShoppingItems(shoppingItemsResult.rows);

      const allWarnings = [...ingredientsResult.warnings, ...recipesResult.warnings, ...recipeIngredientsResult.warnings, ...planSlotsResult.warnings];
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
        onResult: (result) => handleFlushResultRef.current(result),
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
    if (!confirmed || !meta || !engine) return EMPTY_LOTS;
    return previewSnapshotWithPending(confirmed, pending, meta, engine.applyNewEvents).lots;
  }, [confirmed, meta, pending, engine]);

  const ingredientsById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient] as const)),
    [ingredients],
  );

  const lines = useMemo<readonly ShoppingListLine[]>(() => {
    if (!settings) return [];
    const computed = computeShoppingList({ range, planSlots, recipes, recipeIngredients, settings, lots });
    const computedKeys = new Set(computed.map(keyForLine));
    // Sticky lines (see the module doc comment): a just-checked-off line
    // that the engine no longer returns (now fully covered) stays visible,
    // checked, for the rest of this session — scoped to THIS range only.
    const sticky = [...stickyLines.values()].filter(
      (line) =>
        line.rangeStart === range.start && line.rangeEnd === range.end && !computedKeys.has(keyForLine(line)),
    );
    return [...computed, ...sticky];
  }, [range, planSlots, recipes, recipeIngredients, settings, lots, stickyLines]);

  const totalNeededIngredientCount = useMemo(() => {
    if (!settings) return 0;
    const needs = computeNeeds(range, planSlots, recipes, recipeIngredients, settings);
    return new Set(needs.map((n) => n.ingredientId)).size;
  }, [range, planSlots, recipes, recipeIngredients, settings]);

  const checkedByIngredient = useMemo(() => {
    const map = new Map<IngredientId, ShoppingItem>();
    for (const item of shoppingItems) {
      if (item.rangeStart === range.start && item.rangeEnd === range.end) {
        map.set(item.ingredientId, item);
      }
    }
    return map;
  }, [shoppingItems, range]);

  const persistShoppingItem = useCallback(
    async (item: ShoppingItem): Promise<void> => {
      setShoppingItems((current) => {
        const key = keyForItem(item);
        const next = current.filter((existing) => keyForItem(existing) !== key);
        return [...next, item];
      });
      try {
        await store.shoppingItems.upsert(item);
      } catch (err) {
        showToast({ variant: "error", title: "Couldn't save the checked state", description: messageOf(err) });
      }
    },
    [store, showToast],
  );

  const checkOff = useCallback(
    async (line: ShoppingListLine, input: CheckOffInput): Promise<void> => {
      if (!engine) return;
      const event = checkOffShoppingItem(
        {
          ingredientId: line.ingredientId,
          neededQuantity: line.neededQuantity,
          location: input.location,
          ...(input.actualQuantity !== undefined ? { actualQuantity: input.actualQuantity } : {}),
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
        showToast({ variant: "error", title: "Couldn't save the check-off", description: messageOf(err) });
        return;
      }
      showToast({ variant: "success", title: `${event.quantity.amount} ${event.quantity.unit} checked off`, durationMs: 3000 });
      void engine.controller.flushNow();

      // Keeps this line visible/checked for the rest of the session even
      // once the live recompute above stops returning it — see the module
      // doc comment and `lines`'s own merge.
      setStickyLines((current) => new Map(current).set(keyForLine(line), line));

      await persistShoppingItem({
        ingredientId: line.ingredientId,
        rangeStart: line.rangeStart,
        rangeEnd: line.rangeEnd,
        neededQuantity: line.neededQuantity,
        checked: true,
        boughtQuantity: event.quantity,
      });
    },
    [engine, clock, rng, showToast, persistShoppingItem],
  );

  const uncheck = useCallback(
    async (line: ShoppingListLine): Promise<void> => {
      // Un-checking never retracts the purchase event (invariant 1 —
      // InventoryEvents rows are immutable); it only clears the persisted
      // "checked" flag, e.g. for a mis-tap. Correcting an actual purchase
      // goes through Pantry's "Correct" action.
      setStickyLines((current) => {
        const key = keyForLine(line);
        if (!current.has(key)) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      });
      await persistShoppingItem({
        ingredientId: line.ingredientId,
        rangeStart: line.rangeStart,
        rangeEnd: line.rangeEnd,
        neededQuantity: line.neededQuantity,
        checked: false,
      });
    },
    [persistShoppingItem],
  );

  const retry = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const retryFlush = useCallback(() => {
    if (engine) void engine.controller.flushNow();
  }, [engine]);

  return {
    loading,
    error,
    warnings,
    ingredientsById,
    recipes,
    recipeIngredients,
    planSlots,
    settings,
    lines,
    totalNeededIngredientCount,
    checkedByIngredient,
    failedCheckoff,
    retry,
    retryFlush,
    checkOff,
    uncheck,
  };
}
