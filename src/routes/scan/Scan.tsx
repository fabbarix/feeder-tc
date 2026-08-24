/**
 * The scan route (M6 — DESIGN_PRODUCTS.md §1): camera permission, live
 * decode (native `BarcodeDetector` where available, a lazily-loaded WASM
 * fallback otherwise — `src/scan/useBarcodeScanner.ts`), and a manual
 * barcode-entry field that is ALWAYS present, never gated behind a failure
 * state — "a manual barcode-entry field is the fallback — never a dead
 * end" (task brief). A known barcode opens `KnownProductFlow` (§1.3); an
 * unknown one opens `ProductEditorPanel` (§1.2).
 *
 * There is no approved mock for this screen yet (`design/mock-responsive.html`
 * only carries a "Scan a barcode" FAB, wired to a "coming soon" toast —
 * `Shopping.tsx`'s previous doc comment). This route reuses existing idioms
 * throughout rather than inventing new ones: `ConfirmDialog` for the known-
 * product confirm step (same shape as `ShoppingRow.tsx`'s check-off sheet),
 * plain route-container layout for the product editor (same shape as
 * `IngredientEditor.tsx`), and the kit's own `EmptyState`/`ErrorState`/
 * `Skeleton` for load/failure states.
 *
 * SEAM NOTE for whoever lands `DESIGN_PURCHASING.md`'s general shopping-row
 * stepper: `BuyQuantityControl.tsx` (used by `KnownProductFlow`) is the
 * scan-path's own copy of that same need/buy/surplus idea, kept local to
 * this route on purpose (the coordinator asked that the general kit
 * stepper not be built here, to avoid colliding with that in-flight
 * package). Once that stepper exists, `BuyQuantityControl` is the obvious
 * thing to delete in favour of it — nothing else in this route depends on
 * its internals beyond the `amount`/`onChange`/`defaultQuantity` shape.
 */
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, Skeleton } from "../../ui/components";
import { useToast } from "../../ui/components/Toast/useToast.ts";
import { Barcode as BarcodeIcon, CameraSlash } from "../../ui/icons.ts";
import { makeBarcode, type Barcode, type Product } from "../../domain/index.ts";
import { useBarcodeScanner } from "../../scan/useBarcodeScanner.ts";
import { useScanFlow } from "./useScanFlow.ts";
import { KnownProductFlow, type KnownProductPurchaseInput } from "./KnownProductFlow.tsx";
import { ProductEditorPanel, type ProductEditorSaveInput } from "./ProductEditorPanel.tsx";
import styles from "./scan.module.css";
import forms from "../forms.module.css";

type Phase =
  | { readonly kind: "scanning" }
  | { readonly kind: "known"; readonly product: Product; readonly barcode: Barcode }
  | { readonly kind: "new"; readonly barcode: Barcode };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function Scan() {
  const flow = useScanFlow();
  const { showToast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });
  const [manualCode, setManualCode] = useState("");
  const [manualError, setManualError] = useState<string | undefined>(undefined);
  const [savingNew, setSavingNew] = useState(false);

  function handleRawCode(raw: string): void {
    let barcode: Barcode;
    try {
      barcode = makeBarcode(raw.trim());
    } catch {
      setManualError("That doesn't look like a valid barcode (6-14 digits).");
      return;
    }
    setManualError(undefined);
    setManualCode("");
    const product = flow.productsByBarcode.get(barcode);
    setPhase(product ? { kind: "known", product, barcode } : { kind: "new", barcode });
  }

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanner = useBarcodeScanner(videoRef, phase.kind === "scanning" && !flow.loading, handleRawCode);

  function backToScanning(): void {
    setPhase({ kind: "scanning" });
  }

  async function handleConfirmKnown(product: Product, barcode: Barcode, input: KnownProductPurchaseInput): Promise<void> {
    await flow.recordPurchase({
      ingredientId: product.ingredientId,
      buyQuantity: input.buyQuantity,
      location: input.location,
      purchaseDate: input.purchaseDate,
      ...(input.expiryOverride !== undefined ? { expiryOverride: input.expiryOverride } : {}),
    });
    if (input.price !== undefined) {
      await flow.recordPrice({
        ingredientId: product.ingredientId,
        barcode,
        quantity: input.buyQuantity,
        price: input.price,
        ...(input.source !== undefined ? { source: input.source } : {}),
      });
    }
    backToScanning();
  }

  async function handleSaveNewProduct(barcode: Barcode, input: ProductEditorSaveInput): Promise<void> {
    setSavingNew(true);
    try {
      const saved = await flow.saveProduct(input.product, barcode);
      if (saved.status === "conflict") {
        // WP-stale-save: someone else already added this exact barcode
        // between this device's scan and this save — see useScanFlow.ts's
        // `saveProduct` doc comment. Falls back to the normal known-product
        // flow against THEIR definition rather than overwriting it with
        // this device's (possibly different) one.
        showToast({
          variant: "warning",
          title: "Someone already added this product",
          description: "Using the product they already added instead of overwriting it.",
        });
        setPhase({ kind: "known", product: saved.existing, barcode });
        return;
      }
      if (input.photoDataUrl !== undefined) {
        await flow.savePhoto("product", saved.product.id, input.photoDataUrl);
      }
      await flow.recordPurchase({
        ingredientId: input.product.ingredientId,
        buyQuantity: input.product.canonicalQuantity,
        location: flow.ingredientsById.get(input.product.ingredientId)?.defaultLocation ?? "pantry",
        purchaseDate: flow.today,
      });
      if (input.price !== undefined) {
        await flow.recordPrice({
          ingredientId: input.product.ingredientId,
          barcode,
          quantity: input.product.canonicalQuantity,
          price: input.price,
          ...(input.source !== undefined ? { source: input.source } : {}),
        });
      }
      backToScanning();
    } finally {
      setSavingNew(false);
    }
  }

  const activeIngredient = phase.kind === "known" ? flow.ingredientsById.get(phase.product.ingredientId) : undefined;

  return (
    <section>
      <p>
        <Link to="/shopping" className={styles.backLink}>
          &larr; Shopping
        </Link>
      </p>
      <h1>Scan a barcode</h1>

      {flow.loading ? (
        <>
          <Skeleton height="1.8rem" width="35%" />
          <Skeleton />
          <Skeleton />
        </>
      ) : null}

      {!flow.loading && flow.error ? (
        <ErrorState title="Couldn't load your catalog" description={flow.error} onRetry={flow.retry} />
      ) : null}

      {!flow.loading && !flow.error && phase.kind === "scanning" ? (
        <>
          <p className={forms.hint}>Point the camera at a barcode, or type it below.</p>
          <div className={styles.cameraFrame}>
            <video ref={videoRef} className={styles.video} autoPlay playsInline muted aria-hidden="true" />
            {scanner.status === "scanning" ? <div className={styles.viewfinder} /> : null}
            {scanner.status !== "scanning" ? (
              <div className={styles.cameraOverlay}>
                <CameraSlash size={32} aria-hidden="true" />
                {scanner.status === "denied" ? <p>Camera access was denied.</p> : null}
                {scanner.status === "unavailable" ? <p>No camera was found on this device.</p> : null}
                {scanner.status === "decoder-unavailable" ? (
                  <p>The barcode reader isn't available offline yet on this device.</p>
                ) : null}
                {scanner.status === "error" ? <p>Couldn't start the camera{scanner.errorMessage ? `: ${scanner.errorMessage}` : "."}</p> : null}
                {scanner.status === "starting" || scanner.status === "idle" ? <p>Starting camera…</p> : null}
                {scanner.status === "denied" ||
                scanner.status === "unavailable" ||
                scanner.status === "decoder-unavailable" ||
                scanner.status === "error" ? (
                  <>
                    <p className={styles.cameraHint}>Type the barcode below instead.</p>
                    <button type="button" className={styles.retryButton} onClick={scanner.retry}>
                      Try the camera again
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <form
            className={styles.manualEntry}
            onSubmit={(event) => {
              event.preventDefault();
              handleRawCode(manualCode);
            }}
          >
            <div className={forms.field}>
              <label htmlFor="manual-barcode">Enter barcode manually</label>
              <input
                id="manual-barcode"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="e.g. 8001120000123"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value.replace(/[^0-9]/g, ""))}
              />
            </div>
            <button type="submit" className={forms.saveButton} disabled={manualCode.trim() === ""}>
              Look up
            </button>
          </form>
          {manualError ? (
            <p className={forms.hint} role="alert">
              {manualError}
            </p>
          ) : null}
        </>
      ) : null}

      {!flow.loading && !flow.error && phase.kind === "known" && activeIngredient ? (
        <>
          {/* WP-products-screen: the scan flow's own entry point into the
              full product screen (name/brand, barcodes, price charts, merge
              suggestions) — a separate route (src/routes/products/**), not
              inline here, same "one entry point" pattern as before this
              package (M6, DESIGN_PRODUCTS.md §1.4). */}
          <p>
            <Link to={`/products/${phase.product.id}`} className={styles.backLink}>
              View this product
            </Link>
          </p>
          <KnownProductFlow
            product={phase.product}
            ingredient={activeIngredient}
            need={flow.shoppingNeedByIngredient.get(phase.product.ingredientId)}
            today={flow.today}
            currencySymbol={flow.currencySymbol}
            previousSources={flow.previousSources}
            onConfirm={(input) => void handleConfirmKnown(phase.product, phase.barcode, input)}
            onCancel={backToScanning}
          />
        </>
      ) : null}

      {!flow.loading && !flow.error && phase.kind === "known" && !activeIngredient ? (
        <ErrorState
          title="This product's ingredient is missing"
          description="Its catalog entry may have been deleted. Re-scan after fixing the catalog, or edit the product from Settings."
          onRetry={backToScanning}
        />
      ) : null}

      {!flow.loading && !flow.error && phase.kind === "new" ? (
        <ProductEditorPanel
          barcode={phase.barcode}
          ingredients={flow.ingredients}
          shoppingNeedByIngredient={flow.shoppingNeedByIngredient}
          currencySymbol={flow.currencySymbol}
          previousSources={flow.previousSources}
          saving={savingNew}
          onSave={(input) =>
            void handleSaveNewProduct(phase.barcode, input).catch((err: unknown) =>
              showToast({ variant: "error", title: "Couldn't save this product", description: messageOf(err) }),
            )
          }
          onCancel={backToScanning}
        />
      ) : null}

      {!flow.loading && !flow.error && phase.kind === "scanning" && flow.ingredients.length === 0 ? (
        <EmptyState
          icon={BarcodeIcon}
          title="No ingredients yet"
          description="Add ingredients to your catalog first, so a scanned product has something to link to."
        />
      ) : null}
    </section>
  );
}
