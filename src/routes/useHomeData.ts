/**
 * Home route's data load + "mark tonight cooked" action, extracted out of
 * `Home.tsx` — same "retry means two different things" fix as
 * `useRecipesData.ts`'s own header comment (pattern audit #2). Same shape
 * (`{ loading, error, retry }`) as every other route data hook now converges
 * on (`usePantryInventory.ts`, `usePlanWeek.ts`, `products/useProductsData.ts`).
 */
import { useCallback, useEffect, useState } from "react";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import type { PlanSlot, Recipe, RecipeIngredient, Settings } from "../domain/index.ts";
import { describeError as messageOf } from "../sheets/error-messages.ts";

export interface UseHomeDataResult {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly recipes: readonly Recipe[];
  readonly recipeIngredients: readonly RecipeIngredient[];
  readonly planSlots: readonly PlanSlot[];
  readonly settings: Settings | undefined;
  readonly syncedAt: string | undefined;
  readonly retry: () => void;
  readonly markingSlotId: string | undefined;
  readonly markSlotCooked: (slotId: string) => Promise<void>;
}

export function useHomeData(): UseHomeDataResult {
  const { store, clock } = useWorkbookContext();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [recipeIngredients, setRecipeIngredients] = useState<readonly RecipeIngredient[]>([]);
  const [planSlots, setPlanSlots] = useState<readonly PlanSlot[]>([]);
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [syncedAt, setSyncedAt] = useState<string | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);
  const [markingSlotId, setMarkingSlotId] = useState<string | undefined>(undefined);

  useEffect(() => {
    // `loading`/`error` only ever set from the promise's own resolution
    // below — same react-hooks discipline as every other route container.
    let cancelled = false;
    Promise.all([store.recipes.readAll(), store.recipeIngredients.readAll(), store.planSlots.readAll(), store.settings.read()])
      .then(([recipesResult, linesResult, slotsResult, settingsResult]) => {
        if (cancelled) return;
        setRecipes(recipesResult.rows);
        setRecipeIngredients(linesResult.rows);
        setPlanSlots(slotsResult.rows);
        setSettings(settingsResult);
        setSyncedAt(clock.now());
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, clock, reloadToken]);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  /**
   * WP-stale-save: re-reads and applies `state: "cooked"` to the freshest
   * row rather than spreading the LOCAL `tonightSlot` this route already
   * had — same "protect other fields, not the toggle itself" merge as
   * `usePlanWeek.ts`'s `persistSlot` doc comment. If the slot is gone, or
   * its filling is now empty, this does NOT resurrect a "cooked" recipe
   * slot out of it — that would be recreating state someone else
   * deliberately removed — it toasts instead and leaves the dashboard to
   * catch up on its next load.
   */
  const markSlotCooked = useCallback(
    async (slotId: string): Promise<void> => {
      setMarkingSlotId(slotId);
      try {
        const latestRows = (await store.planSlots.readAll()).rows;
        const latest = latestRows.find((s) => s.id === slotId);
        if (!latest || latest.filling.kind === "empty") {
          showToast({
            variant: "warning",
            title: "This meal changed elsewhere",
            description: "Reload to see tonight's current plan.",
          });
          return;
        }
        const updated: PlanSlot = { ...latest, state: "cooked" };
        await store.planSlots.upsert(updated);
        setPlanSlots((current) => current.map((s) => (s.id === updated.id ? updated : s)));
        // No success toast (UX review round 2, "quieten the toasts"): once
        // `state` above flips to "cooked", Tonight's card swaps straight
        // from the "Mark cooked" button to its cooked rendering — that IS
        // the confirmation.
      } catch (err) {
        showToast({ variant: "error", title: "Couldn't mark this cooked", description: messageOf(err) });
      } finally {
        setMarkingSlotId(undefined);
      }
    },
    [store, showToast],
  );

  return {
    loading,
    error,
    recipes,
    recipeIngredients,
    planSlots,
    settings,
    syncedAt,
    retry,
    markingSlotId,
    markSlotCooked,
  };
}
