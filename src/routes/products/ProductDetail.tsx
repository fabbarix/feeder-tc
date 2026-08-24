import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  SegmentedControl,
  Skeleton,
} from "../../ui/components";
import { PhotoField, type PhotoDraft } from "../../ui/photo/index.ts";
import { ArrowsClockwise, Barcode as BarcodeIcon, Tag, Trash } from "../../ui/icons.ts";
import { getPhotoDataUrl } from "../../photos/index.ts";
import { applyPhotoDraft } from "../photo-save.ts";
import { useWorkbookContext } from "../../workbook-context.ts";
import { IntegerField, TextField } from "../fields.tsx";
import { ENTRY_UNIT_OPTIONS, BULK_OPTIONS, entryUnitsFor } from "../scan/scan-options.ts";
import { convertEntryToCanonical } from "../../domain/units.ts";
import { observationsForProduct, suggestProductMerges, type ProductMergeSuggestion } from "../../domain/products.ts";
import { makeBarcode, type Barcode, type EntryUnit, type Product } from "../../domain/index.ts";
import { useProductsData } from "./useProductsData.ts";
import { normalizedPointsFor } from "./price-history-aggregate.ts";
import { averageAcrossShopsView, byShopView, overallView } from "./price-chart-views.ts";
import { basisLabel } from "./currency-format.ts";
import { ProductPriceChart, type ChartSeriesInput } from "./ProductPriceChart.tsx";
import styles from "./products.module.css";
import forms from "../forms.module.css";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type ChartView = "overall" | "by-shop" | "average";

const CHART_VIEW_OPTIONS: readonly { value: ChartView; label: string }[] = [
  { value: "overall", label: "Overall" },
  { value: "by-shop", label: "By shop" },
  { value: "average", label: "Average" },
];

const SERIES_COLORS = ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6"] as const;

/**
 * One product's own screen (WP-products-screen) — the missing repair path
 * the task brief opens with: see its details, fix them, see and edit which
 * barcodes belong to it, and review/confirm merge suggestions, all in one
 * place a person can actually reach (from the products list, from an
 * ingredient's editor, from the scan flow, and from the price-history
 * lists). `.mainDetail` container (AppShell.tsx) — see that file's own
 * doc comment on why.
 */
export function ProductDetail() {
  const { productId } = useParams();
  const { store, clock } = useWorkbookContext();
  const data = useProductsData();

  const product = productId ? data.products.find((p) => p.id === productId) : undefined;
  const ingredient = product ? data.ingredientsById.get(product.ingredientId) : undefined;
  const barcodes = product ? (data.barcodesByProduct.get(product.id) ?? []) : [];

  // --- Edit form state, seeded once the product loads ---
  const [name, setName] = useState<string | undefined>(undefined);
  const [brand, setBrand] = useState("");
  const [entryUnit, setEntryUnit] = useState<EntryUnit>("g");
  const [amount, setAmount] = useState<number | null>(null);
  const [shelfLifeDays, setShelfLifeDays] = useState<number | null>(null);
  const [isBulk, setIsBulk] = useState(false);
  const [initialHasPhoto, setInitialHasPhoto] = useState(false);
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft>({
    status: "unchanged",
  });
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  // Seeds the form fields once, the first time this product finishes
  // loading — a `useEffect` (not a direct `setState`-during-render call)
  // so React Compiler can keep optimizing this component, same discipline
  // as `IngredientEditor.tsx`'s identical load-then-seed effect.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!product || seededRef.current) return;
    seededRef.current = true;
    setName(product.name);
    setBrand(product.brand ?? "");
    setEntryUnit(product.displayUnit);
    setAmount(product.displayQuantity);
    setShelfLifeDays(product.shelfLifeDays);
    setIsBulk(product.isBulk);
    setInitialHasPhoto(product.hasPhoto);
  }, [product]);

  // --- Barcodes ---
  const [newBarcode, setNewBarcode] = useState("");
  const [barcodeError, setBarcodeError] = useState<string | undefined>(undefined);
  const [barcodeToRemove, setBarcodeToRemove] = useState<Barcode | undefined>(undefined);

  const productId_ = product?.id;

  // --- Merge suggestions ---
  const allSuggestions = useMemo(() => suggestProductMerges(data.products), [data.products]);
  const mySuggestions = useMemo(
    () => (productId_ ? allSuggestions.filter((s) => s.a.id === productId_ || s.b.id === productId_) : []),
    [allSuggestions, productId_],
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [pendingMerge, setPendingMerge] = useState<ProductMergeSuggestion | undefined>(undefined);

  // --- Chart ---
  const [chartView, setChartView] = useState<ChartView>("overall");
  const [hiddenSeries, setHiddenSeries] = useState<ReadonlySet<string>>(new Set());
  const points = useMemo(
    () => (productId_ ? normalizedPointsFor(observationsForProduct(data.observations, productId_, data.productBarcodes)) : []),
    [data.observations, data.productBarcodes, productId_],
  );
  const basis = points[0]?.basis;

  async function handleSave(): Promise<void> {
    if (!product || name === undefined) return;
    setSaveError(undefined);
    if (name.trim() === "") {
      setSaveError("Enter a product name.");
      return;
    }
    if (amount === null || amount <= 0) {
      setSaveError("Enter the package content.");
      return;
    }
    if (shelfLifeDays === null || shelfLifeDays <= 0) {
      setSaveError("Enter a default expiry.");
      return;
    }
    if (!ingredient) {
      setSaveError("This product's ingredient no longer exists — it can't be saved.");
      return;
    }
    try {
      const canonicalQuantity = convertEntryToCanonical({ amount, unit: entryUnit }, ingredient.unit);
      const hasPhotoFinal = await applyPhotoDraft(store, clock, "product", product.id, initialHasPhoto, photoDraft);
      const updated: Product = {
        ...product,
        name: name.trim(),
        ...(brand.trim() !== "" ? { brand: brand.trim() } : {}),
        canonicalQuantity,
        displayQuantity: amount,
        displayUnit: entryUnit,
        shelfLifeDays,
        isBulk,
        hasPhoto: hasPhotoFinal,
      };
      await data.saveProduct(updated);
    } catch (err) {
      setSaveError(messageOf(err));
    }
  }

  async function handleAddBarcode(): Promise<void> {
    if (!product) return;
    setBarcodeError(undefined);
    let parsed: Barcode;
    try {
      parsed = makeBarcode(newBarcode.trim());
    } catch (err) {
      setBarcodeError(messageOf(err));
      return;
    }
    const failure = await data.addBarcode(product.id, parsed);
    if (failure) {
      setBarcodeError(failure);
      return;
    }
    setNewBarcode("");
  }

  function toggleSeries(key: string): void {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const chartSeries: readonly ChartSeriesInput[] = useMemo(() => {
    if (chartView === "overall") {
      return [{ key: "overall", label: "Overall", color: "series-1", buckets: overallView(points).buckets }];
    }
    if (chartView === "average") {
      return [{ key: "average", label: "Average across shops", color: "series-1", buckets: averageAcrossShopsView(points).buckets }];
    }
    return byShopView(points).map((series, index) => ({
      key: series.shop ?? "__not-noted__",
      label: series.shop ?? "Not noted",
      color: series.shop === undefined ? undefined : SERIES_COLORS[index % SERIES_COLORS.length],
      buckets: series.buckets,
    }));
  }, [chartView, points]);

  const averageExcluded = chartView === "average" ? averageAcrossShopsView(points).excludedUnlabeledCount : 0;
  const byShopHasOnlyUnlabeled = chartView === "by-shop" && chartSeries.every((s) => s.color === undefined);

  return (
    <section>
      <p>
        <Link to="/products" className={forms.backLink}>
          &larr; Products
        </Link>
      </p>

      {data.loading ? (
        <>
          <h1>Product</h1>
          <Skeleton />
        </>
      ) : null}

      {!data.loading && data.error ? (
        <>
          <h1>Product</h1>
          <ErrorState title="Couldn't load this product" description={data.error} onRetry={data.retry} />
        </>
      ) : null}

      {!data.loading && !data.error && !product ? (
        <>
          <h1>Product</h1>
          <ErrorState title="No such product" description={`No product with id "${productId}".`} />
        </>
      ) : null}

      {!data.loading && !data.error && product ? (
        <>
          <div className={styles.headRow}>
            <div>
              <h1>{product.name}</h1>
              <p className={styles.subline}>
                {ingredient ? (
                  <>
                    <Link to={`/recipes/ingredients/${ingredient.id}`} className={forms.itemLink}>
                      {ingredient.name}
                    </Link>{" "}
                    · {product.displayQuantity} {product.displayUnit}
                  </>
                ) : (
                  "Ingredient not found"
                )}
              </p>
            </div>
          </div>

          {mySuggestions.filter((s) => !dismissed.has(s.a.id + s.b.id)).length > 0 ? (
            <>
              {mySuggestions
                .filter((s) => !dismissed.has(s.a.id + s.b.id))
                .map((suggestion) => {
                  const other = suggestion.a.id === product.id ? suggestion.b : suggestion.a;
                  const key = suggestion.a.id + suggestion.b.id;
                  return (
                    <div className={styles.mergeCard} key={key}>
                      <div className={styles.mergeHead}>
                        <ArrowsClockwise size={18} aria-hidden="true" />
                        Might be the same as &ldquo;{other.name}&rdquo;
                        {suggestion.confidence === "high" ? " (strong match)" : " (possible match)"}
                      </div>
                      <ul className={styles.mergeReasons}>
                        {suggestion.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                      <div className={styles.mergeActions}>
                        <button type="button" className={forms.saveButton} onClick={() => setPendingMerge(suggestion)}>
                          Combine into this product
                        </button>
                        <button
                          type="button"
                          className={forms.cancelButton}
                          onClick={() => setDismissed((current) => new Set(current).add(key))}
                        >
                          Not the same product
                        </button>
                      </div>
                    </div>
                  );
                })}
            </>
          ) : null}

          <div className={forms.sectionCard}>
            <div className={forms.sectionCardHead}>Details</div>
            <div className={forms.sectionCardBody}>
              <form
                className={forms.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSave();
                }}
              >
                <TextField label="Name" value={name ?? ""} onChange={setName} required />
                <TextField label="Brand" value={brand} onChange={setBrand} placeholder="Optional" />

                <div className={forms.field}>
                  <span className={forms.fieldLabel}>Photo</span>
                  <PhotoField
                    hasPhoto={initialHasPhoto}
                    fetchPhoto={() => getPhotoDataUrl(store, "product", product.id)}
                    value={photoDraft}
                    onChange={setPhotoDraft}
                  />
                </div>

                {ingredient ? (
                  <div className={forms.field}>
                    <span className={forms.fieldLabel}>Package size</span>
                    <SegmentedControl<EntryUnit>
                      aria-label="Package unit"
                      options={ENTRY_UNIT_OPTIONS.filter((o) => entryUnitsFor(ingredient.unit).includes(o.value))}
                      value={entryUnit}
                      onChange={setEntryUnit}
                    />
                    <IntegerField label="Amount" value={amount} onChange={setAmount} min={1} />
                  </div>
                ) : null}

                <div className={forms.field}>
                  <span className={forms.fieldLabel}>Product type</span>
                  <SegmentedControl<"packaged" | "bulk">
                    aria-label="Product type"
                    options={BULK_OPTIONS}
                    value={isBulk ? "bulk" : "packaged"}
                    onChange={(v) => setIsBulk(v === "bulk")}
                  />
                </div>

                <IntegerField label="Default expiry" suffix="days" value={shelfLifeDays} onChange={setShelfLifeDays} required />

                {saveError ? (
                  <p className={forms.hint} role="alert">
                    {saveError}
                  </p>
                ) : null}

                <div className={forms.actions}>
                  <button type="submit" className={forms.saveButton} disabled={data.saving}>
                    {data.saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className={forms.sectionCard}>
            <div className={forms.sectionCardHead}>Barcodes</div>
            <div className={forms.sectionCardBody}>
              {barcodes.length === 0 ? (
                <p className={forms.hint}>No barcodes attached yet — add the one on the package below.</p>
              ) : (
                <div className={styles.barcodeList}>
                  {barcodes.map((barcode) => (
                    <div className={styles.barcodeRow} key={barcode}>
                      <span className={styles.barcodeValue}>
                        <BarcodeIcon size={16} aria-hidden="true" /> {barcode}
                      </span>
                      <button
                        type="button"
                        className={forms.removeButton}
                        onClick={() => setBarcodeToRemove(barcode)}
                        aria-label={`Remove barcode ${barcode}`}
                      >
                        <Trash size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.barcodeAddRow}>
                <div className={forms.field}>
                  <label htmlFor="new-barcode">Add a barcode</label>
                  <input
                    id="new-barcode"
                    type="text"
                    inputMode="numeric"
                    value={newBarcode}
                    onChange={(event) => setNewBarcode(event.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="e.g. 8001120000123"
                  />
                </div>
                <button type="button" className={forms.addButton} onClick={() => void handleAddBarcode()} disabled={newBarcode.trim() === ""}>
                  Add
                </button>
              </div>
              {barcodeError ? (
                <p className={forms.hint} role="alert">
                  {barcodeError}
                </p>
              ) : null}
            </div>
          </div>

          <div className={forms.sectionCard}>
            <div className={forms.sectionCardHead}>Price</div>
            <div className={forms.sectionCardBody}>
              {points.length === 0 ? (
                <EmptyState
                  icon={Tag}
                  title="No prices recorded yet"
                  description="Record one the next time you scan a barcode for this product at checkout."
                />
              ) : (
                <>
                  <div className={styles.viewToolbar}>
                    <SegmentedControl<ChartView> aria-label="Chart view" options={CHART_VIEW_OPTIONS} value={chartView} onChange={setChartView} />
                  </div>

                  {chartView === "average" && chartSeries[0]?.buckets.length === 0 ? (
                    <EmptyState
                      icon={Tag}
                      title="Not enough shops noted yet"
                      description="Average across shops needs at least one priced observation with a shop recorded. Note where you shop when you check items off, and this fills in."
                    />
                  ) : chartView === "by-shop" && byShopHasOnlyUnlabeled ? (
                    <>
                      <EmptyState
                        icon={Tag}
                        title="No shop noted yet"
                        description="Every price so far was recorded without a shop. Note where you shop when you check items off, and each shop gets its own line here."
                      />
                      <ProductPriceChart
                        series={chartSeries}
                        hiddenKeys={hiddenSeries}
                        onToggle={toggleSeries}
                        currencySymbol={data.currencySymbol}
                        basisLabel={basis ? basisLabel(basis) : ""}
                      />
                    </>
                  ) : (
                    <ProductPriceChart
                      series={chartSeries}
                      hiddenKeys={hiddenSeries}
                      onToggle={toggleSeries}
                      currencySymbol={data.currencySymbol}
                      basisLabel={basis ? basisLabel(basis) : ""}
                      toggleable={chartView === "by-shop"}
                    />
                  )}

                  {chartView === "average" && averageExcluded > 0 ? (
                    <p className={styles.chartNote}>
                      {averageExcluded} observation{averageExcluded === 1 ? "" : "s"} with no recorded shop excluded
                      from this average.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={pendingMerge !== undefined}
        title="Combine these products?"
        description={
          pendingMerge && product
            ? `Every barcode and price observation from "${pendingMerge.a.id === product.id ? pendingMerge.b.name : pendingMerge.a.name}" moves onto "${product.name}". This can't be undone from here.`
            : undefined
        }
        confirmLabel="Combine"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          if (pendingMerge && product) {
            const other = pendingMerge.a.id === product.id ? pendingMerge.b : pendingMerge.a;
            void data.confirmMerge(product.id, other.id);
          }
          setPendingMerge(undefined);
        }}
        onCancel={() => setPendingMerge(undefined)}
      />

      <ConfirmDialog
        open={barcodeToRemove !== undefined}
        title="Remove this barcode?"
        description={
          barcodeToRemove
            ? `"${barcodeToRemove}" will no longer be linked to this product. Its past price observations stay recorded, but won't show here any more.`
            : undefined
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          if (barcodeToRemove) void data.removeBarcode(barcodeToRemove);
          setBarcodeToRemove(undefined);
        }}
        onCancel={() => setBarcodeToRemove(undefined)}
      />
    </section>
  );
}
