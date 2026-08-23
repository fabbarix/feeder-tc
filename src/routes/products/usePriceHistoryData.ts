/**
 * Read-only data container for the price-history view (M6 —
 * DESIGN_PRODUCTS.md §1.4). Deliberately much simpler than
 * `useScanFlow.ts`/`usePantryInventory.ts`: this view "records nothing"
 * (task brief) — no Outbox, no engine, no Snapshot/SnapshotStore, just
 * three `readAll()`s plus a best-effort `settings.read()`, shared across
 * the three price-history routes instead of each re-fetching independently.
 *
 * `settings.read()` is fetched separately from the other three, and its
 * failure does NOT fail the whole view (unlike `Ingredients.tsx`'s pattern
 * of one big `Promise.all`): a workbook with no `Settings` row yet
 * (Settings.tsx's own "no settings row" recovery case) still has perfectly
 * good price history to show — `currencySymbol` just falls back to the
 * documented default (`"$"`, DESIGN_PRODUCTS.md §4) rather than blocking
 * the page on a problem this read-only view has no way to fix anyway
 * (Settings.tsx is where that gets repaired).
 */
import { useCallback, useEffect, useState } from "react";
import { useWorkbookContext } from "../../workbook-context.ts";
import { useToast } from "../../ui/components/Toast/useToast.ts";
import type {
  Barcode,
  DataWarning,
  Ingredient,
  IngredientId,
  PriceObservation,
  Product,
  ProductBarcode,
  Settings,
} from "../../domain/index.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface PriceHistoryData {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly ingredients: readonly Ingredient[];
  readonly ingredientsById: ReadonlyMap<IngredientId, Ingredient>;
  readonly products: readonly Product[];
  readonly productsByBarcode: ReadonlyMap<Barcode, Product>;
  readonly observations: readonly PriceObservation[];
  /** `Settings.currency`, defaulting to `"$"` (DESIGN_PRODUCTS.md §4) — never hardcode a symbol elsewhere, always read it from here. */
  readonly currencySymbol: string;
  readonly retry: () => void;
}

export function usePriceHistoryData(): PriceHistoryData {
  const { store } = useWorkbookContext();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [ingredients, setIngredients] = useState<readonly Ingredient[]>([]);
  const [products, setProducts] = useState<readonly Product[]>([]);
  const [productBarcodes, setProductBarcodes] = useState<readonly ProductBarcode[]>([]);
  const [observations, setObservations] = useState<readonly PriceObservation[]>([]);
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // loading/error are only ever set from boot()'s own resolution
    // (react-hooks set-state-in-effect rule), same discipline as every
    // other route hook in this app.
    let cancelled = false;

    async function boot(): Promise<void> {
      const [ingredientsResult, productsResult, productBarcodesResult, observationsResult] = await Promise.all([
        store.ingredients.readAll(),
        store.products.readAll(),
        store.productBarcodes.readAll(),
        store.priceObservations.readAll(),
      ]);
      if (cancelled) return;

      setIngredients(ingredientsResult.rows);
      setProducts(productsResult.rows);
      setProductBarcodes(productBarcodesResult.rows);
      setObservations(observationsResult.rows);

      const warnings: readonly DataWarning[] = [
        ...ingredientsResult.warnings,
        ...productsResult.warnings,
        ...productBarcodesResult.warnings,
        ...observationsResult.warnings,
      ];
      const first = warnings[0];
      if (first) {
        showToast({
          variant: "warning",
          title: `${warnings.length} row${warnings.length === 1 ? "" : "s"} skipped`,
          description: first.reason,
        });
      }

      // Best-effort, separate from the required reads above — see this
      // module's doc comment for why a missing/broken Settings row must not
      // fail this whole read-only view.
      try {
        const settingsResult = await store.settings.read();
        if (!cancelled) setSettings(settingsResult);
      } catch {
        if (!cancelled) setSettings(undefined);
      }
    }

    boot()
      .then(() => {
        if (!cancelled) setError(undefined);
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
  }, [store, reloadToken, showToast]);

  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient] as const));
  // WP-PRODUCTS-MODEL: `Product` no longer carries its own barcode(s) — this
  // join over `ProductBarcodes` reconstructs the barcode-keyed view every
  // price-history route already expects (see useScanFlow.ts's identical join
  // for the reasoning).
  const productsById = new Map(products.map((product) => [product.id, product] as const));
  const productsByBarcode = new Map<Barcode, Product>();
  for (const row of productBarcodes) {
    const product = productsById.get(row.productId);
    if (product) productsByBarcode.set(row.barcode, product);
  }
  const currencySymbol = settings?.currency ?? "$";

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  return {
    loading,
    error,
    ingredients,
    ingredientsById,
    products,
    productsByBarcode,
    observations,
    currencySymbol,
    retry,
  };
}
