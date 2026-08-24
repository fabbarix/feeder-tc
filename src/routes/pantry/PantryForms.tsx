import { useState } from "react";
import { DateChips, QuantityInput, SegmentedControl, SelectSheet } from "../../ui/components";
import type { Ingredient, IngredientId, IsoDate, StorageLocation } from "../../domain/index.ts";
import type { AddLotInput, UseSomeInput } from "./usePantryInventory.ts";
import { LOCATION_OPTIONS, expiryOverrideOptions, purchaseDateOptions } from "./pantry-options.ts";
import styles from "./pantry.module.css";
import forms from "../forms.module.css";

function sortedOptions(ingredients: readonly Ingredient[]): { value: IngredientId; label: string }[] {
  return [...ingredients].sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ value: i.id, label: i.name }));
}

export interface AddLotFormProps {
  readonly ingredients: readonly Ingredient[];
  readonly today: IsoDate;
  readonly onSubmit: (input: AddLotInput) => void;
  readonly onCancel: () => void;
}

/** "Already in my pantry" — manual add-lot (IMPLEMENTATION_PLAN.md WP-21). Builds a `PurchaseEvent`; the canonical unit follows the chosen ingredient (invariant 3 — never a unit picker). */
export function AddLotForm({ ingredients, today, onSubmit, onCancel }: AddLotFormProps) {
  const [ingredientId, setIngredientId] = useState<IngredientId | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [location, setLocation] = useState<StorageLocation>("pantry");
  const [purchaseDate, setPurchaseDate] = useState<IsoDate>(today);
  const [expiryOverride, setExpiryOverride] = useState<IsoDate | null>(null);

  const ingredient = ingredients.find((i) => i.id === ingredientId) ?? null;
  const canSubmit = ingredient !== null && amount !== null && amount > 0;

  function selectIngredient(id: IngredientId): void {
    setIngredientId(id);
    setAmount(null);
    const found = ingredients.find((i) => i.id === id);
    if (found) setLocation(found.defaultLocation);
  }

  return (
    <div className={styles.panel}>
      <form
        className={forms.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!ingredient || amount === null || amount <= 0) return;
          onSubmit({
            ingredientId: ingredient.id,
            quantity: { amount, unit: ingredient.unit },
            location,
            purchaseDate,
            ...(expiryOverride !== null ? { expiryOverride } : {}),
          });
        }}
      >
        <SelectSheet
          label="Ingredient"
          options={sortedOptions(ingredients)}
          value={ingredientId}
          onChange={selectIngredient}
          placeholder="Choose an ingredient…"
        />
        <QuantityInput
          label="Amount"
          unit={ingredient?.unit ?? "g"}
          value={amount}
          onChange={(q) => setAmount(q?.amount ?? null)}
          disabled={ingredient === null}
          required
        />
        <div className={forms.field}>
          <span className={forms.fieldLabel}>Location</span>
          <SegmentedControl<StorageLocation> aria-label="Location" options={LOCATION_OPTIONS} value={location} onChange={setLocation} />
        </div>
        <DateChips label="Purchase date" options={purchaseDateOptions(today)} value={purchaseDate} onChange={setPurchaseDate} allowPick />
        <DateChips
          label="Expiry override (optional — otherwise uses the catalog default)"
          options={expiryOverrideOptions(today)}
          value={expiryOverride}
          onChange={setExpiryOverride}
          allowPick
        />
        <div className={forms.actions}>
          <button type="submit" className={forms.saveButton} disabled={!canSubmit}>
            Add to pantry
          </button>
          <button type="button" className={forms.cancelButton} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export interface UseSomeFormProps {
  readonly ingredients: readonly Ingredient[];
  readonly onSubmit: (input: UseSomeInput) => void;
  readonly onCancel: () => void;
}

/** Manual usage entry — FIFO decides the lot(s) at fold time; there is deliberately no lot picker here (invariant 4). */
export function UseSomeForm({ ingredients, onSubmit, onCancel }: UseSomeFormProps) {
  const [ingredientId, setIngredientId] = useState<IngredientId | null>(null);
  const [amount, setAmount] = useState<number | null>(null);

  const ingredient = ingredients.find((i) => i.id === ingredientId) ?? null;
  const canSubmit = ingredient !== null && amount !== null && amount > 0;

  return (
    <div className={styles.panel}>
      <form
        className={forms.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!ingredient || amount === null || amount <= 0) return;
          onSubmit({ ingredientId: ingredient.id, quantity: { amount, unit: ingredient.unit } });
        }}
      >
        <SelectSheet
          label="Ingredient"
          options={sortedOptions(ingredients)}
          value={ingredientId}
          onChange={(id) => {
            setIngredientId(id);
            setAmount(null);
          }}
          placeholder="Choose an ingredient…"
        />
        <QuantityInput
          label="Amount used"
          unit={ingredient?.unit ?? "g"}
          value={amount}
          onChange={(q) => setAmount(q?.amount ?? null)}
          disabled={ingredient === null}
          required
        />
        <div className={forms.actions}>
          <button type="submit" className={forms.saveButton} disabled={!canSubmit}>
            Record usage
          </button>
          <button type="button" className={forms.cancelButton} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
