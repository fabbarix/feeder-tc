/**
 * Owns the Plan route's data and every mutation WP-22 lists: generate week,
 * per-slot reroll/pin/manual-pick/scale override, and the mark-cooked flow
 * (FIFO usage events + leftover lot, both via the outbox — invariant 9).
 *
 * `PlanSlot`/`Settings` are plain rows (`WorkbookStore.planSlots.upsert`,
 * `.settings.write`) — last-write-wins, no outbox, same as
 * `RecipeEditor.tsx`'s `store.recipes.upsert`. Only `InventoryEvent`s
 * (usage + the leftover-lot purchase) go through the outbox, matching
 * `usePantryInventory.ts`'s pattern exactly (own local outbox + connectivity
 * + flush controller, keyed by workbookId — multiple instances over the
 * same localStorage-backed outbox are equivalent, since the queue itself is
 * the persisted state, not any one instance's memory).
 *
 * Cross-week staple rotation state (`StaplePlanState`, WP-13's
 * `generateWeek` — an explicit value the caller must persist and pass back)
 * is NOT stored in the workbook: `Settings` is frozen (HANDOVER.md) and this
 * value is a scheduling hint, not household-facing data, so it lives in
 * localStorage via `src/sync/planner-state-store.ts`, per workbook — see
 * that module's header comment for the invariant-5 reasoning.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkbookContext } from "../../workbook-context.ts";
import { useToast } from "../../ui/components/Toast/useToast.ts";
import {
  addDays,
  buildUseEvent,
  createApplyNewEvents,
  createLeftoverLot,
  expandWeekSlots,
  generateWeek as generateWeekEngine,
  initialStaplePlanState,
  makeQuantity,
  resolveTargetServings,
  rerollSlot,
  scaledRecipeIngredients,
  setSlotPinned,
} from "../../domain/index.ts";
import type {
  Ingredient,
  IngredientId,
  InventoryEvent,
  IsoDate,
  Lot,
  MealTag,
  Meta,
  PlanSlot,
  PlanSlotId,
  Recipe,
  RecipeId,
  RecipeIngredient,
  Settings,
  Snapshot,
  StorageLocation,
} from "../../domain/index.ts";
import type { StaplePlanState } from "../../domain/planner/generator.ts";
import {
  createBrowserConnectivityMonitor,
  createLocalStorageOutbox,
  createLocalStoragePlannerStateStore,
  createLocalStorageSnapshotStore,
  createOutboxSyncController,
  previewSnapshotWithPending,
  syncSnapshot,
} from "../../sync/index.ts";
import { LEFTOVER_DEFAULT_LOCATION, LEFTOVER_FREEZER_SHELF_LIFE_DAYS, LEFTOVER_FRIDGE_SHELF_LIFE_DAYS } from "../../data/index.ts";
import { pickableRecipesForTag } from "./plan-options.ts";
import { resolveLeftoverIngredient } from "./leftover-ingredient.ts";
import { formatWeekHeading, formatWeekRange, mondayOnOrBefore, weekDates } from "./plan-week.ts";
import {
  buildSlotView,
  computeExpiringIngredientIds,
  computeWeekSummary,
  groupSlotsByDay,
  mergeWeekSlots,
  type PlanDay,
  type WeekSummary,
} from "./plan-derive.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildIngredientIndex(lines: readonly RecipeIngredient[]): Map<RecipeId, Set<IngredientId>> {
  const map = new Map<RecipeId, Set<IngredientId>>();
  for (const line of lines) {
    const set = map.get(line.recipeId) ?? new Set<IngredientId>();
    set.add(line.ingredientId);
    map.set(line.recipeId, set);
  }
  return map;
}

export interface MarkCookedLineDraft {
  readonly ingredientId: IngredientId;
  readonly ingredientName: string;
  readonly unit: Ingredient["unit"];
  readonly suggestedAmount: number;
}

export interface MarkCookedDraft {
  readonly slotId: PlanSlotId;
  readonly recipeName: string;
  readonly targetServings: number;
  readonly lines: readonly MarkCookedLineDraft[];
  readonly surplusServings: number;
}

export interface ConfirmMarkCookedLine {
  readonly ingredientId: IngredientId;
  readonly amount: number;
  readonly skip: boolean;
}

export interface ConfirmMarkCookedInput {
  readonly lines: readonly ConfirmMarkCookedLine[];
  /** `null` skips leftover-lot creation entirely (e.g. the household ate it all). */
  readonly leftover: { readonly amount: number; readonly location: StorageLocation } | null;
}

interface Engine {
  readonly outbox: ReturnType<typeof createLocalStorageOutbox>;
  readonly applyNewEvents: ReturnType<typeof createApplyNewEvents>;
  readonly controller: ReturnType<typeof createOutboxSyncController>;
}

const EMPTY_LOTS: readonly Lot[] = [];

export interface UsePlanWeekResult {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly settings: Settings | undefined;
  readonly weekStart: IsoDate;
  readonly weekHeading: string;
  readonly weekRange: string;
  readonly days: readonly PlanDay[];
  readonly summary: WeekSummary;
  readonly generating: boolean;
  readonly busySlotIds: ReadonlySet<PlanSlotId>;
  readonly markCookedDraft: MarkCookedDraft | undefined;
  readonly retry: () => void;
  readonly goToPreviousWeek: () => void;
  readonly goToNextWeek: () => void;
  readonly generateWeek: () => Promise<void>;
  readonly reroll: (slotId: PlanSlotId) => Promise<void>;
  readonly togglePin: (slotId: PlanSlotId) => Promise<void>;
  readonly pickRecipe: (slotId: PlanSlotId, recipeId: RecipeId) => Promise<void>;
  readonly clearSlot: (slotId: PlanSlotId) => Promise<void>;
  readonly setScaleServings: (slotId: PlanSlotId, servings: number | undefined) => Promise<void>;
  readonly pickableRecipes: (mealTag: MealTag) => readonly Recipe[];
  readonly startMarkCooked: (slotId: PlanSlotId) => void;
  readonly cancelMarkCooked: () => void;
  readonly confirmMarkCooked: (input: ConfirmMarkCookedInput) => Promise<void>;
}

export function usePlanWeek(): UsePlanWeekResult {
  const { store, clock, rng, workbookId } = useWorkbookContext();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  const [ingredients, setIngredients] = useState<readonly Ingredient[]>([]);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [recipeIngredients, setRecipeIngredients] = useState<readonly RecipeIngredient[]>([]);
  const [allSlots, setAllSlots] = useState<readonly PlanSlot[]>([]);
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [staplePlanState, setStaplePlanState] = useState<StaplePlanState>(initialStaplePlanState);

  const [confirmed, setConfirmed] = useState<Snapshot | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [pending, setPending] = useState<readonly InventoryEvent[]>([]);
  const [engine, setEngine] = useState<Engine | undefined>(undefined);

  const [weekStart, setWeekStart] = useState<IsoDate>(() => mondayOnOrBefore(clock.today()));
  const [generating, setGenerating] = useState(false);
  const [busySlotIds, setBusySlotIds] = useState<ReadonlySet<PlanSlotId>>(new Set());
  const [markCookedDraft, setMarkCookedDraft] = useState<MarkCookedDraft | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let stopController: (() => void) | undefined;

    async function boot(): Promise<void> {
      const plannerStateStore = createLocalStoragePlannerStateStore();
      const [ingredientsResult, recipesResult, linesResult, slotsResult, loadedSettings, loadedStaples] =
        await Promise.all([
          store.ingredients.readAll(),
          store.recipes.readAll(),
          store.recipeIngredients.readAll(),
          store.planSlots.readAll(),
          store.settings.read(),
          plannerStateStore.load(workbookId),
        ]);
      if (cancelled) return;

      setError(undefined);
      setIngredients(ingredientsResult.rows);
      setRecipes(recipesResult.rows);
      setRecipeIngredients(linesResult.rows);
      setAllSlots(slotsResult.rows);
      setSettings(loadedSettings);
      setStaplePlanState(loadedStaples ?? initialStaplePlanState);

      const warningCount =
        ingredientsResult.warnings.length + recipesResult.warnings.length + linesResult.warnings.length + slotsResult.warnings.length;
      if (warningCount > 0) {
        showToast({
          variant: "warning",
          title: `${warningCount} row${warningCount === 1 ? "" : "s"} skipped while loading`,
          description: "Some workbook rows didn't match the expected shape.",
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
        onResult: () => void refreshInventory(),
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

      // refreshInventory is defined below and closes over `store`/`workbookId`
      // only — declared with `function` so this reference (used in
      // `onResult` above) is hoisted before use.
      async function refreshInventory(): Promise<void> {
        if (cancelled) return;
        const [c, m, p] = await Promise.all([
          syncSnapshot({ workbookStore: store, snapshotStore, applyNewEvents }, workbookId),
          store.meta.read(),
          outbox.pending(),
        ]);
        if (cancelled) return;
        setConfirmed(c);
        setMeta(m);
        setPending(p);
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot() reruns whole-hog on reloadToken; showToast is stable from context.
  }, [store, workbookId, reloadToken]);

  const lots = useMemo<readonly Lot[]>(() => {
    if (!confirmed || !meta || !engine) return EMPTY_LOTS;
    return previewSnapshotWithPending(confirmed, pending, meta, engine.applyNewEvents).lots;
  }, [confirmed, meta, pending, engine]);

  const recipesById = useMemo(() => new Map(recipes.map((r) => [r.id, r] as const)), [recipes]);
  const ingredientsById = useMemo(() => new Map(ingredients.map((i) => [i.id, i] as const)), [ingredients]);
  const lotsById = useMemo(() => new Map(lots.map((l) => [l.id, l] as const)), [lots]);
  const ingredientIndex = useMemo(() => buildIngredientIndex(recipeIngredients), [recipeIngredients]);

  const today = clock.today();
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const dateSet = useMemo(() => new Set(dates), [dates]);
  const weekSpecs = useMemo(() => (settings ? expandWeekSlots(settings, weekStart) : []), [settings, weekStart]);
  const weekSlotRows = useMemo(() => allSlots.filter((s) => dateSet.has(s.date)), [allSlots, dateSet]);
  // The full set of this week's slots as the UI sees them: every configured
  // position (weekSpecs) gets either its real WorkbookStore row or a
  // placeholder empty one — a fresh workbook has no PlanSlot rows at all
  // until "Generate week" (or a manual pick) actually runs, and the week's
  // shape must still render before that (see mergeWeekSlots's doc comment).
  const weekSlots = useMemo(() => mergeWeekSlots(weekSpecs, weekSlotRows), [weekSpecs, weekSlotRows]);
  const historicalSlots = useMemo(() => allSlots.filter((s) => s.date < weekStart), [allSlots, weekStart]);
  const expiringIngredientIds = useMemo(() => computeExpiringIngredientIds(lots, weekStart), [lots, weekStart]);

  const days = useMemo(() => {
    const views = weekSlots.map((slot) => buildSlotView(slot, recipesById, ingredientsById, lotsById, today));
    return groupSlotsByDay(dates, views);
  }, [weekSlots, recipesById, ingredientsById, lotsById, today, dates]);

  const summary = useMemo(
    () =>
      computeWeekSummary(
        weekSlots,
        recipesById,
        historicalSlots,
        weekStart,
        settings?.repeatExclusionWeeks ?? 0,
        today,
      ),
    [weekSlots, recipesById, historicalSlots, weekStart, settings, today],
  );

  // Searches this week's merged view (real rows + placeholders), not just
  // `allSlots` — every action a user can trigger operates on a slot that's
  // currently rendered, and a never-yet-persisted placeholder must resolve
  // here too (e.g. picking a recipe into a slot before any week has been
  // generated).
  const findSlot = useCallback((slotId: PlanSlotId) => weekSlots.find((s) => s.id === slotId), [weekSlots]);

  const persistSlot = useCallback(
    async (next: PlanSlot): Promise<void> => {
      await store.planSlots.upsert(next);
      setAllSlots((current) => {
        const exists = current.some((s) => s.id === next.id);
        return exists ? current.map((s) => (s.id === next.id ? next : s)) : [...current, next];
      });
    },
    [store],
  );

  const withBusy = useCallback(async (slotId: PlanSlotId, fn: () => Promise<void>): Promise<void> => {
    setBusySlotIds((current) => new Set(current).add(slotId));
    try {
      await fn();
    } finally {
      setBusySlotIds((current) => {
        const next = new Set(current);
        next.delete(slotId);
        return next;
      });
    }
  }, []);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);
  const goToPreviousWeek = useCallback(() => setWeekStart((w) => addDays(w, -7)), []);
  const goToNextWeek = useCallback(() => setWeekStart((w) => addDays(w, 7)), []);

  const generateWeek = useCallback(async (): Promise<void> => {
    if (!settings) return;
    setGenerating(true);
    try {
      const result = generateWeekEngine({
        settings,
        weekStart,
        recipes,
        recipeIngredients,
        pastPlanSlots: historicalSlots,
        expiringIngredientIds,
        staplePlanState,
        existingSlots: weekSlots,
        rng,
      });
      await Promise.all(result.slots.map((slot) => store.planSlots.upsert(slot)));
      setAllSlots((current) => {
        const byId = new Map(current.map((s) => [s.id, s] as const));
        for (const slot of result.slots) byId.set(slot.id, slot);
        return [...byId.values()];
      });
      setStaplePlanState(result.staplePlanState);
      const plannerStateStore = createLocalStoragePlannerStateStore();
      await plannerStateStore.save(workbookId, result.staplePlanState);
      showToast({ variant: "success", title: "Week generated.", durationMs: 3000 });
    } catch (err) {
      showToast({ variant: "error", title: "Couldn't generate the week", description: messageOf(err) });
    } finally {
      setGenerating(false);
    }
  }, [settings, weekStart, recipes, recipeIngredients, historicalSlots, expiringIngredientIds, staplePlanState, weekSlots, rng, store, workbookId, showToast]);

  const reroll = useCallback(
    async (slotId: PlanSlotId): Promise<void> => {
      const slot = findSlot(slotId);
      if (!slot || slot.pinned || !settings) return;
      await withBusy(slotId, async () => {
        const weekPlacedRecipeIds = new Set<RecipeId>();
        const weekIngredientIds = new Set<IngredientId>();
        for (const other of weekSlots) {
          if (other.id === slotId || other.filling.kind !== "recipe") continue;
          weekPlacedRecipeIds.add(other.filling.recipeId);
          for (const id of ingredientIndex.get(other.filling.recipeId) ?? []) weekIngredientIds.add(id);
        }
        try {
          const next = rerollSlot({
            slot,
            settings,
            weekStart,
            recipes,
            recipeIngredients,
            pastPlanSlots: historicalSlots,
            weekPlacedRecipeIds,
            weekIngredientIds,
            expiringIngredientIds,
            rng,
          });
          await persistSlot(next);
        } catch (err) {
          showToast({ variant: "error", title: "Couldn't reroll that slot", description: messageOf(err) });
        }
      });
    },
    [findSlot, settings, weekSlots, ingredientIndex, weekStart, recipes, recipeIngredients, historicalSlots, expiringIngredientIds, rng, persistSlot, withBusy, showToast],
  );

  const togglePin = useCallback(
    async (slotId: PlanSlotId): Promise<void> => {
      const slot = findSlot(slotId);
      if (!slot) return;
      await withBusy(slotId, async () => {
        await persistSlot(setSlotPinned(slot, !slot.pinned));
      });
    },
    [findSlot, persistSlot, withBusy],
  );

  const pickRecipe = useCallback(
    async (slotId: PlanSlotId, recipeId: RecipeId): Promise<void> => {
      const slot = findSlot(slotId);
      if (!slot) return;
      await withBusy(slotId, async () => {
        await persistSlot({ ...slot, filling: { kind: "recipe", recipeId } });
      });
    },
    [findSlot, persistSlot, withBusy],
  );

  const clearSlot = useCallback(
    async (slotId: PlanSlotId): Promise<void> => {
      const slot = findSlot(slotId);
      if (!slot) return;
      await withBusy(slotId, async () => {
        await persistSlot({ ...slot, filling: { kind: "empty" }, pinned: false });
      });
    },
    [findSlot, persistSlot, withBusy],
  );

  const setScaleServings = useCallback(
    async (slotId: PlanSlotId, servings: number | undefined): Promise<void> => {
      const slot = findSlot(slotId);
      if (!slot || slot.filling.kind !== "recipe") return;
      const recipeId = slot.filling.recipeId;
      await withBusy(slotId, async () => {
        await persistSlot({
          ...slot,
          filling: servings !== undefined ? { kind: "recipe", recipeId, scaleServings: servings } : { kind: "recipe", recipeId },
        });
      });
    },
    [findSlot, persistSlot, withBusy],
  );

  const pickableRecipes = useCallback((mealTag: MealTag) => pickableRecipesForTag(recipes, mealTag), [recipes]);

  const startMarkCooked = useCallback(
    (slotId: PlanSlotId): void => {
      const slot = findSlot(slotId);
      if (!slot || slot.filling.kind !== "recipe" || !settings) return;
      const recipe = recipesById.get(slot.filling.recipeId);
      if (!recipe) return;
      const targetServings = resolveTargetServings(settings, slot.filling) ?? settings.householdSize;
      const scaledLines = scaledRecipeIngredients(recipe, recipeIngredients, targetServings);
      const lines: MarkCookedLineDraft[] = scaledLines.map((line) => ({
        ingredientId: line.ingredientId,
        ingredientName: ingredientsById.get(line.ingredientId)?.name ?? line.ingredientId,
        unit: line.quantity.unit,
        suggestedAmount: line.quantity.amount,
      }));
      const surplusServings = Math.max(0, targetServings - settings.householdSize);
      setMarkCookedDraft({ slotId, recipeName: recipe.name, targetServings, lines, surplusServings });
    },
    [findSlot, settings, recipesById, recipeIngredients, ingredientsById],
  );

  const cancelMarkCooked = useCallback((): void => setMarkCookedDraft(undefined), []);

  const confirmMarkCooked = useCallback(
    async (input: ConfirmMarkCookedInput): Promise<void> => {
      if (!markCookedDraft || !engine) return;
      const slot = findSlot(markCookedDraft.slotId);
      if (!slot || slot.filling.kind !== "recipe") return;
      const recipe = recipesById.get(slot.filling.recipeId);
      if (!recipe) return;

      await withBusy(markCookedDraft.slotId, async () => {
        try {
          const events: InventoryEvent[] = [];
          for (const line of input.lines) {
            if (line.skip || line.amount <= 0) continue;
            const ingredient = ingredientsById.get(line.ingredientId);
            if (!ingredient) continue;
            events.push(buildUseEvent({ ingredientId: line.ingredientId, quantity: makeQuantity(line.amount, ingredient.unit) }, clock, rng));
          }

          if (input.leftover && input.leftover.amount > 0) {
            const location = input.leftover.location;
            const { ingredient, isNew } = resolveLeftoverIngredient(recipe, ingredients, location);
            if (isNew) {
              await store.ingredients.upsert(ingredient);
              setIngredients((current) => [...current, ingredient]);
            }
            const shelfLifeDays = location === "freezer" ? LEFTOVER_FREEZER_SHELF_LIFE_DAYS : LEFTOVER_FRIDGE_SHELF_LIFE_DAYS;
            events.push(
              createLeftoverLot(
                {
                  ingredientId: ingredient.id,
                  surplusQuantity: makeQuantity(input.leftover.amount, "portion"),
                  location,
                  cookDate: clock.today(),
                  shelfLifeDays,
                },
                clock,
                rng,
              ),
            );
          }

          for (const event of events) {
            await engine.outbox.enqueue(event);
          }
          setPending((current) => [...current, ...events]);
          void engine.controller.flushNow();

          await persistSlot({ ...slot, state: "cooked" });
          setMarkCookedDraft(undefined);
          showToast({ variant: "success", title: `Marked "${recipe.name}" cooked.`, durationMs: 4000 });
        } catch (err) {
          showToast({ variant: "error", title: "Couldn't save that as cooked", description: messageOf(err) });
        }
      });
    },
    [markCookedDraft, engine, findSlot, recipesById, ingredientsById, ingredients, clock, rng, store, persistSlot, withBusy, showToast],
  );

  return {
    loading,
    error,
    settings,
    weekStart,
    weekHeading: formatWeekHeading(weekStart),
    weekRange: formatWeekRange(weekStart),
    days,
    summary,
    generating,
    busySlotIds,
    markCookedDraft,
    retry,
    goToPreviousWeek,
    goToNextWeek,
    generateWeek,
    reroll,
    togglePin,
    pickRecipe,
    clearSlot,
    setScaleServings,
    pickableRecipes,
    startMarkCooked,
    cancelMarkCooked,
    confirmMarkCooked,
  };
}

export const LEFTOVER_LOCATION_DEFAULT = LEFTOVER_DEFAULT_LOCATION;
