/**
 * Recipes route's data load, extracted out of `Recipes.tsx` (pattern audit
 * #2 — "retry means two different things on sibling tabs"). Before this,
 * Recipes/Ingredients/Home loaded data in an inline `useEffect` with no way
 * to re-run it, so their `ErrorState.onRetry` fell back to
 * `window.location.reload()` — a hard reload that throws away scroll
 * position, focus and any typed search — while Pantry/Plan/Products (which
 * already had a `useXxxData`-shaped hook with a `reloadToken`) could soft
 * retry. Same shape as `products/useProductsData.ts`'s own `retry`.
 */
import { useCallback, useEffect, useState } from "react";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import type { Recipe } from "../domain/index.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface UseRecipesDataResult {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly recipes: readonly Recipe[];
  readonly retry: () => void;
}

export function useRecipesData(): UseRecipesDataResult {
  const { store } = useWorkbookContext();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // `loading`/`error` are only ever set from the promise's own
    // resolution below, never synchronously here (react-hooks'
    // set-state-in-effect rule) — their initial `useState` values already
    // cover the first mount.
    let cancelled = false;
    store.recipes
      .readAll()
      .then((result) => {
        if (cancelled) return;
        setRecipes([...result.rows].sort((a, b) => a.name.localeCompare(b.name)));
        setError(undefined);
        const firstReason = result.warnings[0]?.reason;
        if (result.warnings.length > 0) {
          showToast({
            variant: "warning",
            title: `${result.warnings.length} ${result.warnings.length === 1 ? "recipe" : "recipes"} skipped`,
            ...(firstReason !== undefined ? { description: firstReason } : {}),
          });
        }
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
  }, [store, showToast, reloadToken]);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  return { loading, error, recipes, retry };
}
