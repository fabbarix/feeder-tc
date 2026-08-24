/**
 * Owns WP-17's full inventory sync stack for the pantry route: the
 * localStorage `SnapshotStore`, WP-12's `applyNewEvents`/fold, and the
 * shared, app-wide `Outbox` + `OutboxSyncController` for the active
 * workbook (`acquireSharedOutboxSync`, src/sync/outbox-registry.ts) — NOT a
 * private pair built by this hook. Every pantry write goes "build event ->
 * Outbox.enqueue -> flush" (HANDOVER.md invariant 9) — never a direct
 * `WorkbookStore.inventoryEvents.append` call from a component. Each route
 * hook that touches inventory (this one, `useScanFlow`, `usePlanWeek`,
 * `useShoppingList`) used to build its OWN `Outbox` + connectivity monitor +
 * `OutboxSyncController` for the same workbook `App.tsx` was already
 * driving one for — with App's controller always live, that meant two
 * controllers permanently, both waking on the same reconnect and flushing
 * the same pending event, which is how the same `InventoryEvent` ended up
 * appended twice in production. `SnapshotStore` stays a per-route instance
 * (it is genuinely stateless/re-derivable); the outbox and controller do
 * not.
 *
 * `lots` is the OPTIMISTIC read model: the last confirmed snapshot with any
 * still-pending outbox events folded on top (`previewSnapshotWithPending`),
 * so an action the user just took is visible immediately, before the flush
 * completes — WP-17 BDD "the local snapshot reflects both [pending]
 * events". Cursor safety (invariant 2) is `syncSnapshot`'s job: a
 * generation mismatch discards the cache and re-reads fully; if a full
 * re-read still can't resolve it, `syncSnapshot` throws and `boot()`'s
 * catch below surfaces that as `error` (an `ErrorState` with retry) rather
 * than silently pretending nothing happened.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkbookContext } from "../../workbook-context.ts";
import { useToast } from "../../ui/components/Toast/useToast.ts";
import {
  buildCorrectEvent,
  buildMoveEvent,
  buildOpenEvent,
  buildPurchaseEvent,
  buildSpoilEvent,
  buildUseEvent,
  createApplyNewEvents,
} from "../../domain/index.ts";
import type {
  ApplyNewEvents,
  DataWarning,
  EventId,
  Ingredient,
  IngredientId,
  InventoryEvent,
  IsoDate,
  Lot,
  LotId,
  Meta,
  Outbox,
  Quantity,
  Snapshot,
  StorageLocation,
} from "../../domain/index.ts";
import {
  acquireSharedOutboxSync,
  createLocalStorageSnapshotStore,
  previewSnapshotWithPending,
  syncSnapshot,
} from "../../sync/index.ts";
import type { FlushOutboxResult, OutboxSyncController } from "../../sync/index.ts";
import { describeError as messageOf } from "../../sheets/error-messages.ts";

/** The single event id/timestamp a failed flush names, plus the `lotId` it concerned, if any (`UseEvent` has none — see manual-events.ts). Used to mark just that one row `failed` (UI_DESIGN.md §8), never a global "something broke" state. */
interface FlushFailure {
  readonly eventId: EventId;
  readonly lotId: LotId | undefined;
}

interface Engine {
  readonly outbox: Outbox;
  readonly applyNewEvents: ApplyNewEvents;
  readonly controller: OutboxSyncController;
}

export interface AddLotInput {
  readonly ingredientId: IngredientId;
  readonly quantity: Quantity;
  readonly location: StorageLocation;
  readonly purchaseDate: IsoDate;
  readonly expiryOverride?: IsoDate;
}

export interface UseSomeInput {
  readonly ingredientId: IngredientId;
  readonly quantity: Quantity;
}

export interface SpoilInput {
  readonly ingredientId: IngredientId;
  readonly lotId: LotId;
  readonly quantity: Quantity;
}

export interface MoveInput {
  readonly ingredientId: IngredientId;
  readonly lotId: LotId;
  readonly location: StorageLocation;
}

export interface OpenInput {
  readonly ingredientId: IngredientId;
  readonly lotId: LotId;
}

export interface CorrectInput {
  readonly ingredientId: IngredientId;
  readonly lotId: LotId;
  readonly delta?: Quantity;
  readonly expiry?: IsoDate;
  readonly reason?: string;
}

export interface PantryInventory {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly ingredients: readonly Ingredient[];
  readonly ingredientsById: ReadonlyMap<IngredientId, Ingredient>;
  /** Confirmed snapshot + pending outbox events folded on top — see module doc comment. */
  readonly lots: readonly Lot[];
  readonly warnings: readonly DataWarning[];
  readonly failedLot: FlushFailure | undefined;
  /** Re-runs the whole boot sequence (catalog load + full sync) — the top-level `ErrorState`'s retry. */
  readonly retry: () => void;
  /** Re-attempts flushing the outbox now — a single failed row's retry (UI_DESIGN.md §8). */
  readonly retryFlush: () => void;
  readonly addLot: (input: AddLotInput) => Promise<void>;
  readonly useSome: (input: UseSomeInput) => Promise<void>;
  readonly markSpoiled: (input: SpoilInput) => Promise<void>;
  readonly move: (input: MoveInput) => Promise<void>;
  readonly open: (input: OpenInput) => Promise<void>;
  readonly correct: (input: CorrectInput) => Promise<void>;
}

const EMPTY_LOTS: readonly Lot[] = [];

export function usePantryInventory(): PantryInventory {
  const { store, clock, rng, workbookId } = useWorkbookContext();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [ingredients, setIngredients] = useState<readonly Ingredient[]>([]);
  const [warnings, setWarnings] = useState<readonly DataWarning[]>([]);
  const [confirmed, setConfirmed] = useState<Snapshot | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [pending, setPending] = useState<readonly InventoryEvent[]>([]);
  const [failedLot, setFailedLot] = useState<FlushFailure | undefined>(undefined);
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

  const handleFlushResult = useCallback(
    (result: FlushOutboxResult) => {
      const failure = result.failure;
      if (failure) {
        const event = pending.find((e) => e.id === failure.eventId);
        const lotId = event && "lotId" in event ? event.lotId : undefined;
        setFailedLot({ eventId: failure.eventId, lotId });
        showToast({
          variant: "error",
          title: "A pantry change couldn't sync",
          description: messageOf(failure.error),
        });
      } else {
        setFailedLot(undefined);
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
    // `loading`/`error`/`engine` are only ever set from boot()'s own
    // resolution below, never synchronously here (react-hooks'
    // set-state-in-effect rule, same discipline as Recipes.tsx/
    // RecipeEditor.tsx) — the initial `useState` values already cover the
    // first mount, and `boot()` itself resets `error`/`failedLot` right
    // after its first await on every run (including a retry via
    // `reloadToken`).
    let cancelled = false;
    let releaseSharedSync: (() => void) | undefined;

    async function boot(): Promise<void> {
      const ingredientsResult = await store.ingredients.readAll();
      if (cancelled) return;
      setError(undefined);
      setFailedLot(undefined);
      setIngredients(ingredientsResult.rows);
      setWarnings(ingredientsResult.warnings);
      if (ingredientsResult.warnings.length > 0) {
        const first = ingredientsResult.warnings[0];
        showToast({
          variant: "warning",
          title: `${ingredientsResult.warnings.length} ingredient row${ingredientsResult.warnings.length === 1 ? "" : "s"} skipped`,
          ...(first ? { description: first.reason } : {}),
        });
      }

      const catalog = new Map(ingredientsResult.rows.map((ingredient) => [ingredient.id, ingredient] as const));
      const applyNewEvents = createApplyNewEvents(catalog);
      const snapshotStore = createLocalStorageSnapshotStore();
      // The shared, app-wide Outbox + OutboxSyncController for this workbook
      // (src/sync/outbox-registry.ts) — NOT a private one built here. Every
      // route hook and App.tsx acquire the SAME instance for a given
      // workbookId; building a private one per hook is exactly what let the
      // same InventoryEvent be appended twice after an offline→online
      // transition (two independently "live" controllers, each waking on
      // the same reconnect and flushing the same pending event).
      const sharedSync = acquireSharedOutboxSync({
        workbookId,
        workbookStore: store,
        onResult: (result) => handleFlushResultRef.current(result),
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

  const display = useMemo<readonly Lot[]>(() => {
    if (!confirmed || !meta || !engine) return EMPTY_LOTS;
    return previewSnapshotWithPending(confirmed, pending, meta, engine.applyNewEvents).lots;
  }, [confirmed, meta, pending, engine]);

  const ingredientsById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient] as const)),
    [ingredients],
  );

  // No success toast on the happy path (UX review round 2, "quieten the
  // toasts" — this was the cluster the mobile reviewer caught burying the
  // pantry-item rail's own Use some/Open/Move/Correct/Mark spoiled buttons
  // in a burst): `setPending` below is optimistic, so the pantry list
  // already shows the new/changed lot before this function even returns —
  // a toast repeating that on top is noise, not information. The error
  // path still toasts (a failed sync is NOT otherwise visible).
  const submit = useCallback(
    async (event: InventoryEvent): Promise<void> => {
      if (!engine) return;
      setPending((current) => [...current, event]);
      try {
        await engine.outbox.enqueue(event);
      } catch (err) {
        setPending((current) => current.filter((e) => e.id !== event.id));
        showToast({ variant: "error", title: "Couldn't save the change", description: messageOf(err) });
        return;
      }
      void engine.controller.flushNow();
    },
    [engine, showToast],
  );

  const addLot = useCallback(
    async (input: AddLotInput): Promise<void> => {
      await submit(buildPurchaseEvent(input, clock, rng));
    },
    [submit, clock, rng],
  );

  const useSome = useCallback(
    async (input: UseSomeInput): Promise<void> => {
      await submit(buildUseEvent(input, clock, rng));
    },
    [submit, clock, rng],
  );

  const markSpoiled = useCallback(
    async (input: SpoilInput): Promise<void> => {
      await submit(buildSpoilEvent(input, clock, rng));
    },
    [submit, clock, rng],
  );

  const move = useCallback(
    async (input: MoveInput): Promise<void> => {
      await submit(buildMoveEvent(input, clock, rng));
    },
    [submit, clock, rng],
  );

  const open = useCallback(
    async (input: OpenInput): Promise<void> => {
      await submit(buildOpenEvent(input, clock, rng));
    },
    [submit, clock, rng],
  );

  const correct = useCallback(
    async (input: CorrectInput): Promise<void> => {
      await submit(buildCorrectEvent(input, clock, rng));
    },
    [submit, clock, rng],
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
    ingredients,
    ingredientsById,
    lots: display,
    warnings,
    failedLot,
    retry,
    retryFlush,
    addLot,
    useSome,
    markSpoiled,
    move,
    open,
    correct,
  };
}
