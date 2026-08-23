/**
 * The §1.3 "known barcode" flow (DESIGN_PRODUCTS.md): packaged products
 * default the buy amount to whatever the shopping list asked for (or the
 * product's usual package size when there's no live need); bulk products
 * always ask for the weight, using the identical control (coordinator's
 * additional requirement — see `BuyQuantityControl.tsx`'s own doc comment).
 * Optionally records a price against the same purchase, per DESIGN_PRODUCTS
 * §1.3's "optionally record a new price".
 *
 * Reuses the app's existing `ConfirmDialog` idiom (exactly the shape
 * `ShoppingRow.tsx`'s check-off sheet already uses: a dialog whose
 * `description` holds the quantity/location/expiry fields) rather than
 * inventing a new panel chrome for the scan route.
 */
import { useState } from "react";
import { ConfirmDialog, DateChips, QuantityInput, SegmentedControl } from "../../ui/components";
import {
  addDays,
  formatQuantity,
  makeQuantity,
  type Ingredient,
  type IsoDate,
  type Product,
  type Quantity,
  type ShoppingListLine,
  type StorageLocation,
} from "../../domain/index.ts";
import { BuyQuantityControl } from "./BuyQuantityControl.tsx";
import { LOCATION_OPTIONS, expiryOverrideOptions } from "./scan-options.ts";
import styles from "./scan.module.css";

export interface KnownProductPurchaseInput {
  readonly buyQuantity: Quantity;
  readonly location: StorageLocation;
  readonly purchaseDate: IsoDate;
  readonly expiryOverride?: IsoDate;
  readonly price?: number;
  /** Free text naming where this was bought — see `RecordPriceInput.source`'s doc comment (useScanFlow.ts). */
  readonly source?: string;
}

export interface KnownProductFlowProps {
  readonly product: Product;
  readonly ingredient: Ingredient;
  /** This week's live shopping need for this ingredient, if any — "the amount the list asked for" (requirement 1). */
  readonly need: ShoppingListLine | undefined;
  readonly today: IsoDate;
  readonly currencySymbol: string;
  /** Previously-used `source` (shop) values, most-recent-first — offered as datalist suggestions. */
  readonly previousSources: readonly string[];
  readonly onConfirm: (input: KnownProductPurchaseInput) => void;
  readonly onCancel: () => void;
}

/**
 * The parent (`Scan.tsx`) only ever mounts this component while a known
 * product is the active scan result, and fully unmounts it (back to the
 * camera) before the next scan can activate a new one — so, unlike
 * `ShoppingRow.tsx`'s persistently-mounted sheet, there is no "reset on
 * reopen" case to handle: every mount already starts from this product's
 * own defaults via the `useState` initializers below.
 */
export function KnownProductFlow({ product, ingredient, need, today, currencySymbol, previousSources, onConfirm, onCancel }: KnownProductFlowProps) {
  // Packaged products default to the list's need, falling back to the
  // product's own usual package size; bulk products default to the need
  // ONLY (there is no fixed "usual size" for a variable-weight item) and
  // always force the amount field open — DESIGN_PRODUCTS §1.3 + the
  // coordinator's variable-weight requirement.
  const defaultBuyQuantity: Quantity | null = need?.neededQuantity ?? (product.isBulk ? null : product.canonicalQuantity);

  const [amount, setAmount] = useState<number | null>(defaultBuyQuantity?.amount ?? null);
  const [location, setLocation] = useState<StorageLocation>(ingredient.defaultLocation);
  const [expiryOverride, setExpiryOverride] = useState<IsoDate>(() => addDays(today, product.shelfLifeDays));
  const [priceOpen, setPriceOpen] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [source, setSource] = useState("");

  const surplus = defaultBuyQuantity !== null && amount !== null ? amount - defaultBuyQuantity.amount : 0;

  function handleConfirm(): void {
    if (amount === null || amount <= 0) return;
    const buyQuantity = makeQuantity(amount, ingredient.unit);
    onConfirm({
      buyQuantity,
      location,
      purchaseDate: today,
      expiryOverride,
      ...(price !== null && price > 0 ? { price } : {}),
      ...(source.trim() !== "" ? { source: source.trim() } : {}),
    });
  }

  return (
    <ConfirmDialog
      open
      title={need ? `Mark ${product.name} bought` : `Add ${product.name} to pantry`}
      description={
        <div className={styles.dialogForm}>
          {product.brand ? <p className={styles.dialogHint}>{product.brand}</p> : null}

          <BuyQuantityControl
            label={need ? "Quantity bought" : "Amount"}
            unit={ingredient.unit}
            defaultQuantity={defaultBuyQuantity}
            forceOpen={product.isBulk}
            amount={amount}
            onChange={setAmount}
          />

          {/* Surplus is normal, never a warning (DESIGN_PURCHASING.md §2/§6) — plain, neutral text, no colour, no badge. */}
          {surplus > 0 ? (
            <p className={styles.surplusNote}>
              {formatQuantity(makeQuantity(surplus, ingredient.unit))} more than needed — the extra goes straight into
              the pantry.
            </p>
          ) : null}

          <div className={styles.dialogForm}>
            <span className={styles.dialogHint}>Goes to</span>
            <SegmentedControl<StorageLocation> aria-label="Location" options={LOCATION_OPTIONS} value={location} onChange={setLocation} />
          </div>

          <DateChips
            label={`Expiry (defaults to this product's ${product.shelfLifeDays}-day shelf life)`}
            options={expiryOverrideOptions(today)}
            value={expiryOverride}
            onChange={setExpiryOverride}
            allowPick
          />

          {priceOpen ? (
            <>
              <QuantityInput label="Price paid" unit={currencySymbol} value={price} onChange={(q) => setPrice(q?.amount ?? null)} />
              <div className={styles.dialogForm}>
                <label htmlFor="known-product-price-source">Where did you buy this? (optional)</label>
                <input
                  id="known-product-price-source"
                  type="text"
                  list="known-product-price-source-options"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="e.g. Trader Joe's"
                />
                <datalist id="known-product-price-source-options">
                  {previousSources.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </div>
            </>
          ) : (
            <button type="button" className={styles.buyAdjustLink} onClick={() => setPriceOpen(true)}>
              + Record the price you paid
            </button>
          )}
        </div>
      }
      confirmLabel={need ? "Mark bought" : "Add to pantry"}
      onConfirm={handleConfirm}
      onCancel={onCancel}
    />
  );
}
