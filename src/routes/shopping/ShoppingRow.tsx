import { useMemo, useState, type MouseEvent } from "react";
import { CheckRow, ConfirmDialog, DateChips, QuantityInput, SegmentedControl } from "../../ui/components";
import { Minus, Plus } from "../../ui/icons.ts";
import {
  formatQuantity,
  makeQuantity,
  suggestPurchase,
  type Ingredient,
  type IsoDate,
  type Quantity,
  type ShoppingItem,
  type ShoppingListLine,
  type StorageLocation,
} from "../../domain/index.ts";
import { buildProvenanceText, buildRoundingExplanation, type ProvenanceContext } from "./provenance.ts";
import { buyQuantity, defaultLooseStep, formatAmountForUnit, isAdjusted, isRoundedOrAdjusted } from "./purchase-display.ts";
import { LOCATION_OPTIONS, expiryOverrideOptions } from "./checkoff-options.ts";
import type { CheckOffInput } from "./useShoppingList.ts";
import forms from "../forms.module.css";
import styles from "./ShoppingRow.module.css";

export interface ShoppingRowProps {
  readonly line: ShoppingListLine;
  readonly ingredient: Ingredient;
  readonly checkedItem: ShoppingItem | undefined;
  readonly today: IsoDate;
  readonly failed: boolean;
  readonly provenanceContext: ProvenanceContext;
  readonly onRetryFailed: () => void;
  readonly onCheckOff: (input: CheckOffInput) => void;
  readonly onUncheck: () => void;
  /** Persists (or clears, if `undefined`) `ShoppingItem.purchaseOverride` — the adjust stepper (§6 scenario 9). */
  readonly onAdjust: (override: Quantity | undefined) => void;
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
  provenanceContext,
  onRetryFailed,
  onCheckOff,
  onUncheck,
  onAdjust,
}: ShoppingRowProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const buy = buyQuantity(line);
  const [amount, setAmount] = useState<number | null>(buy.amount);
  const [location, setLocation] = useState<StorageLocation>(ingredient.defaultLocation);
  const [expiryOverride, setExpiryOverride] = useState<IsoDate | null>(null);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState<number>(buy.amount);

  const checked = checkedItem?.checked ?? false;
  const adjusted = isAdjusted(line);
  const rounded = isRoundedOrAdjusted(line);
  const why = buildRoundingExplanation(line, ingredient, provenanceContext);
  const suggestion = useMemo(() => suggestPurchase(line.neededQuantity, ingredient), [line.neededQuantity, ingredient]);
  const step = suggestion.mode === "whole" ? (suggestion.packSize?.amount ?? 1) : defaultLooseStep(ingredient);

  function openSheet(): void {
    setAmount(buy.amount);
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

  function openAdjust(event: MouseEvent): void {
    // The quantity sits inside CheckRow's outer <label> (the whole-row tap
    // target for check-off) — stop the click from also toggling the
    // checkbox, same guard CheckRow's own "Retry" button uses.
    event.preventDefault();
    event.stopPropagation();
    setAdjustAmount(buy.amount);
    setAdjustOpen(true);
  }

  function confirmAdjust(): void {
    const override = Math.max(0, adjustAmount);
    onAdjust(override === line.neededQuantity.amount ? undefined : makeQuantity(override, ingredient.unit));
    setAdjustOpen(false);
  }

  const surplusOnAdjust = Math.max(0, adjustAmount - line.neededQuantity.amount);

  const secondary =
    checked && checkedItem?.boughtQuantity ? (
      boughtSecondary(checkedItem)
    ) : (
      <>
        {adjusted ? <span className={styles.adjusted}>Adjusted · </span> : null}
        {rounded ? (
          `needs ${formatAmountForUnit(line.neededQuantity, ingredient)}`
        ) : (
          <>
            <span className={styles.provenanceShort}>{buildProvenanceText(line.sources, "short")}</span>
            <span className={styles.provenanceLong}>{buildProvenanceText(line.sources, "long")}</span>
          </>
        )}
      </>
    );

  return (
    <>
      <CheckRow
        label={ingredient.name}
        secondary={secondary}
        checked={checked}
        onChange={handleChange}
        trailing={
          checked ? (
            formatQuantity(line.neededQuantity)
          ) : (
            <button type="button" className={styles.adjustButton} onClick={openAdjust}>
              {formatAmountForUnit(buy, ingredient)}
            </button>
          )
        }
        failed={failed}
        {...(failed ? { onRetry: onRetryFailed } : {})}
      />
      {!checked && why ? (
        <details className={styles.why}>
          <summary className={styles.whySummary}>Why?</summary>
          <p className={styles.whyText}>{why}</p>
        </details>
      ) : null}

      <ConfirmDialog
        open={sheetOpen}
        title={`Check off ${ingredient.name}`}
        description={
          <div className={styles.dialogForm}>
            <p className={styles.dialogHint}>
              Pre-filled with the suggested buy amount — correct it for what you actually bought.
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

      <ConfirmDialog
        open={adjustOpen}
        title={`Adjust: ${ingredient.name}`}
        description={
          <div className={styles.dialogForm}>
            <p className={styles.dialogHint}>
              This week's recipes need {formatAmountForUnit(line.neededQuantity, ingredient)}. Buying more than you
              need becomes pantry stock, not waste.
            </p>
            <div className={forms.qty}>
              <button
                type="button"
                aria-label="Fewer"
                onClick={() => setAdjustAmount((a) => Math.max(0, a - step))}
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <span className={forms.qtyValue}>{formatAmountForUnit(makeQuantity(adjustAmount, ingredient.unit), ingredient)}</span>
              <button type="button" aria-label="More" onClick={() => setAdjustAmount((a) => a + step)}>
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        }
        confirmLabel={
          surplusOnAdjust > 0
            ? `Save — ${formatQuantity(makeQuantity(surplusOnAdjust, ingredient.unit))} surplus to pantry`
            : "Save"
        }
        onConfirm={confirmAdjust}
        onCancel={() => setAdjustOpen(false)}
      />
    </>
  );
}
