/**
 * Data + write actions for the products screen (browse, detail, barcode
 * repair, merge). Reads the same four sheets `usePriceHistoryData.ts`
 * already reads (products, productBarcodes, ingredients, priceObservations)
 * plus a best-effort `settings.read()` for the currency symbol — same
 * shape, same "a missing Settings row must not block a read-only view"
 * reasoning as that hook's own doc comment. Kept as a SEPARATE hook rather
 * than widening `usePriceHistoryData` because this one also exposes write
 * actions (`saveProduct`, `addBarcode`, `removeBarcode`, `confirmMerge`) —
 * the price-history routes are read-only and should stay that way.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkbookContext } from "../../workbook-context.ts";
import { useToast } from "../../ui/components/Toast/useToast.ts";
import { planProductMerge } from "../../domain/products.ts";
import type {
  Barcode,
  DataWarning,
  Ingredient,
  IngredientId,
  PriceObservation,
  Product,
  ProductBarcode,
  ProductId,
  Settings,
} from "../../domain/index.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface ProductsData {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly products: readonly Product[];
  readonly productsById: ReadonlyMap<ProductId, Product>;
  readonly ingredients: readonly Ingredient[];
  readonly ingredientsById: ReadonlyMap<IngredientId, Ingredient>;
  readonly productBarcodes: readonly ProductBarcode[];
  /** Every barcode currently owned by one product, in no particular order. */
  readonly barcodesByProduct: ReadonlyMap<ProductId, readonly Barcode[]>;
  readonly observations: readonly PriceObservation[];
  readonly currencySymbol: string;
  readonly retry: () => void;
  readonly saving: boolean;
  readonly saveProduct: (product: Product) => Promise<void>;
  /** Attaches a barcode to a product — refuses (returns an error string instead of throwing) if that barcode already belongs to a DIFFERENT product, since silently stealing it would sever that other product's price history rather than merging it on purpose. */
  readonly addBarcode: (productId: ProductId, barcode: Barcode) => Promise<string | undefined>;
  readonly removeBarcode: (barcode: Barcode) => Promise<void>;
  readonly confirmMerge: (keepId: ProductId, dropId: ProductId) => Promise<void>;
}

export function useProductsData(): ProductsData {
  const { store } = useWorkbookContext();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [products, setProducts] = useState<readonly Product[]>([]);
  const [ingredients, setIngredients] = useState<readonly Ingredient[]>([]);
  const [productBarcodeRows, setProductBarcodeRows] = useState<readonly ProductBarcode[]>([]);
  const [observations, setObservations] = useState<readonly PriceObservation[]>([]);
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot(): Promise<void> {
      const [productsResult, ingredientsResult, barcodesResult, observationsResult] = await Promise.all([
        store.products.readAll(),
        store.ingredients.readAll(),
        store.productBarcodes.readAll(),
        store.priceObservations.readAll(),
      ]);
      if (cancelled) return;

      setProducts(productsResult.rows);
      setIngredients(ingredientsResult.rows);
      setProductBarcodeRows(barcodesResult.rows);
      setObservations(observationsResult.rows);

      const warnings: readonly DataWarning[] = [
        ...productsResult.warnings,
        ...ingredientsResult.warnings,
        ...barcodesResult.warnings,
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

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p] as const)), [products]);
  const ingredientsById = new Map(ingredients.map((i) => [i.id, i] as const));
  const barcodesByProduct = new Map<ProductId, Barcode[]>();
  for (const row of productBarcodeRows) {
    const existing = barcodesByProduct.get(row.productId);
    if (existing) existing.push(row.barcode);
    else barcodesByProduct.set(row.productId, [row.barcode]);
  }
  const currencySymbol = settings?.currency ?? "$";

  const saveProduct = useCallback(
    async (product: Product) => {
      setSaving(true);
      try {
        await store.products.upsert(product);
        setProducts((current) => {
          const next = current.filter((p) => p.id !== product.id);
          next.push(product);
          return next;
        });
      } finally {
        setSaving(false);
      }
    },
    [store],
  );

  const addBarcode = useCallback(
    async (productId: ProductId, barcode: Barcode): Promise<string | undefined> => {
      const ownerNow = productBarcodeRows.find((row) => row.barcode === barcode);
      if (ownerNow && ownerNow.productId !== productId) {
        const ownerProduct = productsById.get(ownerNow.productId);
        return `This barcode already belongs to ${ownerProduct?.name ?? "another product"}. Use "Suggested merges" below if this is really the same product, rather than reassigning it here.`;
      }
      setSaving(true);
      try {
        await store.productBarcodes.upsert({ productId, barcode });
        setProductBarcodeRows((current) => [...current.filter((r) => r.barcode !== barcode), { productId, barcode }]);
        return undefined;
      } finally {
        setSaving(false);
      }
    },
    [store, productBarcodeRows, productsById],
  );

  const removeBarcode = useCallback(
    async (barcode: Barcode) => {
      setSaving(true);
      try {
        await store.productBarcodes.remove(barcode);
        setProductBarcodeRows((current) => current.filter((r) => r.barcode !== barcode));
      } finally {
        setSaving(false);
      }
    },
    [store],
  );

  const confirmMerge = useCallback(
    async (keepId: ProductId, dropId: ProductId) => {
      setSaving(true);
      try {
        const plan = planProductMerge(keepId, dropId, productBarcodeRows, observations);
        for (const row of plan.barcodeRows) {
          await store.productBarcodes.upsert(row);
        }
        setProductBarcodeRows((current) => {
          const untouched = current.filter((row) => row.productId !== keepId && row.productId !== dropId);
          return [...untouched, ...plan.barcodeRows];
        });
        showToast({
          variant: "success",
          title: "Products merged",
          description: `${plan.observationsToRollUp.length} price observation${plan.observationsToRollUp.length === 1 ? "" : "s"} now roll up under the kept product.`,
        });
      } finally {
        setSaving(false);
      }
    },
    [store, productBarcodeRows, observations, showToast],
  );

  return {
    loading,
    error,
    products,
    productsById,
    ingredients,
    ingredientsById,
    productBarcodes: productBarcodeRows,
    barcodesByProduct,
    observations,
    currencySymbol,
    retry,
    saving,
    saveProduct,
    addBarcode,
    removeBarcode,
    confirmMerge,
  };
}
