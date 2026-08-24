/**
 * Ingredients route's data load, extracted out of `Ingredients.tsx` — same
 * "retry means two different things" fix as `useRecipesData.ts`'s own
 * header comment (pattern audit #2). Same shape as
 * `products/useProductsData.ts`'s `retry`.
 */
import { useCallback, useEffect, useState } from "react";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import type { Ingredient } from "../domain/index.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface UseIngredientsDataResult {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly ingredients: readonly Ingredient[];
  readonly retry: () => void;
}

export function useIngredientsData(): UseIngredientsDataResult {
  const { store } = useWorkbookContext();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [ingredients, setIngredients] = useState<readonly Ingredient[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // `loading`/`error` are only ever set from the promise's own
    // resolution below, never synchronously here (react-hooks'
    // set-state-in-effect rule) — their initial `useState` values already
    // cover the first mount.
    let cancelled = false;
    store.ingredients
      .readAll()
      .then((result) => {
        if (cancelled) return;
        setIngredients([...result.rows].sort((a, b) => a.name.localeCompare(b.name)));
        setError(undefined);
        const firstReason = result.warnings[0]?.reason;
        if (result.warnings.length > 0) {
          showToast({
            variant: "warning",
            title: `${result.warnings.length} ${result.warnings.length === 1 ? "ingredient" : "ingredients"} skipped`,
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

  return { loading, error, ingredients, retry };
}
