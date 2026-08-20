import { useState } from "react";
import { CheckRow, ConfirmDialog, DateChips, QuantityInput, SegmentedControl } from "../../ui/components";
import {
  formatQuantity,
  makeQuantity,
  type Ingredient,
  type IsoDate,
  type ShoppingItem,
  type ShoppingListLine,
  type StorageLocation,
} from "../../domain/index.ts";
import { buildProvenanceText } from "./provenance.ts";
import { LOCATION_OPTIONS, expiryOverrideOptions } from "./checkoff-options.ts";
import type { CheckOffInput } from "./useShoppingList.ts";
import styles from "./ShoppingRow.module.css";

export interface ShoppingRowProps {
  readonly line: ShoppingListLine;
  readonly ingredient: Ingredient;
  readonly checkedItem: ShoppingItem | undefined;
  readonly today: IsoDate;
  readonly failed: boolean;
  readonly onRetryFailed: () => void;
  readonly onCheckOff: (input: CheckOffInput) => void;
  readonly onUncheck: () => void;
}

/** "bought 1000 ml · 500 ml to pantry" when the purchased package was bigger than the need (the mock's Olive oil row); plain "bought 1000 ml" otherwise. */
function boughtSecondary(item: ShoppingItem): string {
  const bought = item.boughtQuantity;
  if (!bought) return "";
  const surplus = bought.amount - item.neededQuantity.amount;
  if (surplus > 0) {
    return `bought ${formatQuantity(bought)} · ${formatQuantity(makeQuantity(surplus, bought.unit))} to pantry`;
  }
  return `bought ${formatQuantity(bought)}`;
}

/**
 * One line of the generated list, in-store variant (`CheckRow` — the whole
 * row is the tap target, UI_DESIGN.md §6). Checking a not-yet-checked row
 * opens a small confirm sheet pre-filled with the needed quantity — the
 * "quantity override" the WP scope calls for (DESIGN.md §2: "a quantity
 * field...corrects for package sizes") — rather than writing a
 * `PurchaseEvent` on the bare tap; un-checking an already-checked row just
 * clears the persisted flag (invariant 1 forbids retracting the purchase
 * event itself — see `useShoppingList.ts`'s `uncheck`).
 */
export function ShoppingRow({
  line,
  ingredient,
  checkedItem,
  today,
  failed,
  onRetryFailed,
  onCheckOff,
  onUncheck,
}: ShoppingRowProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(line.neededQuantity.amount);
  const [location, setLocation] = useState<StorageLocation>(ingredient.defaultLocation);
  const [expiryOverride, setExpiryOverride] = useState<IsoDate | null>(null);

  const checked = checkedItem?.checked ?? false;

  function openSheet(): void {
    setAmount(line.neededQuantity.amount);
    setLocation(ingredient.defaultLocation);
    setExpiryOverride(null);
    setSheetOpen(true);
  }

  function handleChange(nextChecked: boolean): void {
    if (nextChecked) {
      openSheet();
    } else {
      onUncheck();
    }
  }

  function confirmCheckOff(): void {
    if (amount === null || amount <= 0) return;
    onCheckOff({
      actualQuantity: makeQuantity(amount, ingredient.unit),
      location,
      ...(expiryOverride !== null ? { expiryOverride } : {}),
    });
    setSheetOpen(false);
  }

  const secondary =
    checked && checkedItem?.boughtQuantity ? (
      boughtSecondary(checkedItem)
    ) : (
      <>
        <span className={styles.provenanceShort}>{buildProvenanceText(line.sources, "short")}</span>
        <span className={styles.provenanceLong}>{buildProvenanceText(line.sources, "long")}</span>
      </>
    );

  return (
    <>
      <CheckRow
        label={ingredient.name}
        secondary={secondary}
        checked={checked}
        onChange={handleChange}
        trailing={formatQuantity(line.neededQuantity)}
        failed={failed}
        {...(failed ? { onRetry: onRetryFailed } : {})}
      />

      <ConfirmDialog
        open={sheetOpen}
        title={`Check off ${ingredient.name}`}
        description={
          <div className={styles.dialogForm}>
            <p className={styles.dialogHint}>
              Pre-filled with the needed amount — correct it for the package size you actually bought.
            </p>
            <QuantityInput
              label="Quantity bought"
              unit={ingredient.unit}
              value={amount}
              onChange={(q) => setAmount(q?.amount ?? null)}
              required
            />
            <div className={styles.dialogForm}>
              <span className={styles.dialogHint}>Goes to</span>
              <SegmentedControl<StorageLocation>
                aria-label="Location"
                options={LOCATION_OPTIONS}
                value={location}
                onChange={setLocation}
              />
            </div>
            <DateChips
              label="Expiry override (optional — otherwise uses the catalog default)"
              options={expiryOverrideOptions(today)}
              value={expiryOverride}
              onChange={setExpiryOverride}
              allowPick
            />
          </div>
        }
        confirmLabel="Mark bought"
        onConfirm={confirmCheckOff}
        onCancel={() => setSheetOpen(false)}
      />
    </>
  );
}
