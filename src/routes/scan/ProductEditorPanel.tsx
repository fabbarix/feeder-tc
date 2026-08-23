/**
 * The §1.2 "unknown barcode" flow (DESIGN_PRODUCTS.md): the product editor.
 * Collects name, brand, an ingredient link (pickable from the current
 * shopping list for speed — §1.2), an optional photo (the existing
 * `Photos` pipeline, `src/photos/**`), entry unit + package content
 * (converted to the ingredient's canonical unit exactly once, via
 * `src/domain/units.ts` — invariant 3's one narrow, owner-approved
 * exception), a default expiry as a duration, the bulk flag, and an
 * optional price — then saves the product AND records this scan as the
 * first purchase of it in one submit (no separate confirm step: the
 * package-content amount just entered IS the buy amount for this purchase).
 *
 * This is a route-level container (`src/routes/scan/**`), not `src/ui/**`
 * — UI_DESIGN.md §7's component-boundary lint only restricts the kit
 * itself, so this file may import `src/domain/units.ts` directly, exactly
 * like `IngredientEditor.tsx`/`RecipeEditor.tsx` import engines their own
 * kit siblings cannot.
 */
import { useMemo, useState } from "react";
import { QuantityInput, SegmentedControl, SelectSheet } from "../../ui/components";
import { ImageSquare } from "../../ui/icons.ts";
import { convertEntryToCanonical } from "../../domain/units.ts";
import type {
  Barcode,
  EntryUnit,
  Ingredient,
  IngredientId,
  ShoppingListLine,
} from "../../domain/index.ts";
import type { NewProductInput } from "./useScanFlow.ts";
import { IntegerField, TextField } from "../fields.tsx";
import { BULK_OPTIONS, ENTRY_UNIT_OPTIONS, SHELF_LIFE_PRESET_DAYS, entryUnitsFor } from "./scan-options.ts";
import styles from "./scan.module.css";
import forms from "../forms.module.css";

export interface ProductEditorSaveInput {
  /** WP-PRODUCTS-MODEL: no `id` yet — `useScanFlow.ts`'s `saveProduct` mints the `ProductId` at save time (see that function's own doc comment). */
  readonly product: NewProductInput;
  readonly photoDataUrl?: string;
  readonly price?: number;
  /** Free text naming where this was bought — see the module doc comment on `RecordPriceInput.source`. */
  readonly source?: string;
}

export interface ProductEditorPanelProps {
  readonly barcode: Barcode;
  readonly ingredients: readonly Ingredient[];
  readonly shoppingNeedByIngredient: ReadonlyMap<IngredientId, ShoppingListLine>;
  readonly currencySymbol: string;
  /** Previously-used `source` (shop) values, most-recent-first — offered as datalist suggestions. */
  readonly previousSources: readonly string[];
  readonly saving: boolean;
  readonly onSave: (input: ProductEditorSaveInput) => void;
  readonly onCancel: () => void;
}

function ingredientOptions(
  ingredients: readonly Ingredient[],
  shoppingNeedByIngredient: ReadonlyMap<IngredientId, ShoppingListLine>,
): { value: IngredientId; label: string }[] {
  // Leftover-lot-only ingredients (canonical unit "portion") never have a
  // real-world barcoded product — units.ts has no entry-time equivalent for
  // that unit, so they are excluded here rather than surfacing a picker
  // choice that would always fail conversion.
  const eligible = ingredients.filter((i) => i.unit !== "portion");
  const onList = eligible.filter((i) => shoppingNeedByIngredient.has(i.id)).sort((a, b) => a.name.localeCompare(b.name));
  const rest = eligible.filter((i) => !shoppingNeedByIngredient.has(i.id)).sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...onList.map((i) => ({ value: i.id, label: `${i.name} — on your list` })),
    ...rest.map((i) => ({ value: i.id, label: i.name })),
  ];
}

async function readFileAsDataUrl(file: File): Promise<string> {
  const { encodePhotoDataUrl } = await import("../../photos/index.ts");
  return encodePhotoDataUrl(file);
}

export function ProductEditorPanel({
  barcode,
  ingredients,
  shoppingNeedByIngredient,
  currencySymbol,
  previousSources,
  saving,
  onSave,
  onCancel,
}: ProductEditorPanelProps) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [ingredientId, setIngredientId] = useState<IngredientId | null>(null);
  const [entryUnit, setEntryUnit] = useState<EntryUnit>("g");
  const [amount, setAmount] = useState<number | null>(null);
  const [shelfLifeDays, setShelfLifeDays] = useState<number | null>(180);
  const [purchaseMode, setPurchaseMode] = useState<"packaged" | "bulk">("packaged");
  const [priceOpen, setPriceOpen] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [source, setSource] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>(undefined);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [validationError, setValidationError] = useState<string | undefined>(undefined);

  const options = useMemo(() => ingredientOptions(ingredients, shoppingNeedByIngredient), [ingredients, shoppingNeedByIngredient]);
  const ingredient = ingredients.find((i) => i.id === ingredientId) ?? null;
  const entryUnitChoices = ingredient ? entryUnitsFor(ingredient.unit) : [];
  const entryUnitOptions = ENTRY_UNIT_OPTIONS.filter((o) => entryUnitChoices.includes(o.value));

  function selectIngredient(id: IngredientId): void {
    setIngredientId(id);
    const found = ingredients.find((i) => i.id === id);
    const choices = found ? entryUnitsFor(found.unit) : [];
    setEntryUnit(choices[0] ?? "g");
    setAmount(null);
  }

  async function handlePhotoChange(file: File | undefined): Promise<void> {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPhotoDataUrl(dataUrl);
    } finally {
      setPhotoBusy(false);
    }
  }

  const selectedPreset = SHELF_LIFE_PRESET_DAYS.find((p) => p.days === shelfLifeDays)?.value ?? "";

  function handleSave(): void {
    setValidationError(undefined);
    if (name.trim() === "") {
      setValidationError("Enter a product name.");
      return;
    }
    if (!ingredient) {
      setValidationError("Choose which ingredient this product is.");
      return;
    }
    if (amount === null || amount <= 0) {
      setValidationError("Enter the package content.");
      return;
    }
    if (shelfLifeDays === null || shelfLifeDays <= 0) {
      setValidationError("Enter a default expiry.");
      return;
    }

    let canonicalQuantity;
    try {
      canonicalQuantity = convertEntryToCanonical({ amount, unit: entryUnit }, ingredient.unit);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err));
      return;
    }

    const product: NewProductInput = {
      name: name.trim(),
      ...(brand.trim() !== "" ? { brand: brand.trim() } : {}),
      ingredientId: ingredient.id,
      canonicalQuantity,
      displayQuantity: amount,
      displayUnit: entryUnit,
      shelfLifeDays,
      isBulk: purchaseMode === "bulk",
      hasPhoto: photoDataUrl !== undefined,
    };

    onSave({
      product,
      ...(photoDataUrl !== undefined ? { photoDataUrl } : {}),
      ...(price !== null && price > 0 ? { price } : {}),
      ...(source.trim() !== "" ? { source: source.trim() } : {}),
    });
  }

  return (
    <div className={styles.editorPanel}>
      <h2 className={styles.editorHeading}>New product</h2>
      <p className={forms.hint}>Barcode {barcode} isn't in your catalog yet — tell us what it is.</p>

      <form
        className={forms.form}
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
      >
        <TextField label="Name" value={name} onChange={setName} required placeholder="e.g. Riso Gallo Arborio 1 kg" />
        <TextField label="Brand" value={brand} onChange={setBrand} placeholder="Optional" />

        <SelectSheet
          label="Ingredient"
          options={options}
          value={ingredientId}
          onChange={selectIngredient}
          placeholder="Which ingredient is this?"
        />

        <div className={forms.field}>
          <span>Photo (optional)</span>
          <label className={styles.photoPicker}>
            {photoDataUrl ? (
              <img src={photoDataUrl} alt="" className={styles.photoPreview} />
            ) : (
              <ImageSquare size={28} aria-hidden="true" />
            )}
            <span>{photoBusy ? "Processing…" : photoDataUrl ? "Change photo" : "Add a photo"}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className={styles.photoInput}
              onChange={(event) => void handlePhotoChange(event.target.files?.[0])}
            />
          </label>
        </div>

        {ingredient && entryUnitOptions.length > 1 ? (
          <div className={forms.field}>
            <span>Unit</span>
            <SegmentedControl<EntryUnit> aria-label="Package unit" options={entryUnitOptions} value={entryUnit} onChange={setEntryUnit} />
          </div>
        ) : null}

        <QuantityInput
          label="Package content"
          unit={entryUnit}
          value={amount}
          onChange={(q) => setAmount(q?.amount ?? null)}
          disabled={ingredient === null}
          required
        />

        <div className={forms.field}>
          <span>Product type</span>
          <SegmentedControl<"packaged" | "bulk"> aria-label="Product type" options={BULK_OPTIONS} value={purchaseMode} onChange={setPurchaseMode} />
          <p className={forms.hint}>
            {purchaseMode === "bulk"
              ? "Weight varies bag to bag — every future scan will ask you to weigh it."
              : "Every unit of this product weighs the same."}
          </p>
        </div>

        <div className={forms.field}>
          <span>Default expiry</span>
          <SegmentedControl<string>
            aria-label="Default expiry preset"
            options={SHELF_LIFE_PRESET_DAYS}
            value={selectedPreset}
            onChange={(value) => {
              const preset = SHELF_LIFE_PRESET_DAYS.find((p) => p.value === value);
              if (preset) setShelfLifeDays(preset.days);
            }}
          />
          <IntegerField label="Or enter exactly" suffix="days" value={shelfLifeDays} onChange={setShelfLifeDays} />
        </div>

        {priceOpen ? (
          <>
            <QuantityInput label="Price paid" unit={currencySymbol} value={price} onChange={(q) => setPrice(q?.amount ?? null)} />
            <div className={forms.field}>
              <label htmlFor="product-price-source">Where did you buy this? (optional)</label>
              <input
                id="product-price-source"
                type="text"
                list="product-price-source-options"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="e.g. Trader Joe's"
              />
              <datalist id="product-price-source-options">
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

        {validationError ? (
          <p className={forms.hint} role="alert">
            {validationError}
          </p>
        ) : null}

        <div className={forms.actions}>
          <button type="submit" className={forms.saveButton} disabled={saving}>
            {saving ? "Saving…" : "Save & add to pantry"}
          </button>
          <button type="button" className={forms.cancelButton} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
