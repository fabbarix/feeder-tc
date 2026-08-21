import { useState } from "react";
import { ConfirmDialog, QuantityInput, SegmentedControl } from "../../ui/components";
import type { IngredientId, StorageLocation } from "../../domain/index.ts";
import type { ConfirmMarkCookedInput, MarkCookedDraft } from "./usePlanWeek.ts";
import styles from "./plan.module.css";

const LEFTOVER_LOCATION_OPTIONS: readonly { value: StorageLocation; label: string }[] = [
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
];

export interface MarkCookedDialogProps {
  readonly draft: MarkCookedDraft;
  readonly onConfirm: (input: ConfirmMarkCookedInput) => void;
  readonly onCancel: () => void;
}

/**
 * The mark-cooked confirm/tweak screen (WP-22, DESIGN.md §2 "Cooking"):
 * every scaled ingredient line defaults to its suggested amount, editable
 * or skippable per line, plus — when the recipe was scaled above the
 * household size — a leftover-lot amount/location. Confirming builds
 * exactly the input `usePlanWeek.confirmMarkCooked` needs: FIFO usage
 * events for the non-skipped lines (invariant 4 — no lot picker here,
 * fold-time FIFO decides which lot(s)) and the leftover purchase event,
 * both via the outbox (invariant 9).
 */
export function MarkCookedDialog({ draft, onConfirm, onCancel }: MarkCookedDialogProps) {
  const [amounts, setAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(draft.lines.map((line) => [line.ingredientId, line.suggestedAmount])),
  );
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [leftoverEnabled, setLeftoverEnabled] = useState(draft.surplusServings > 0);
  const [leftoverAmount, setLeftoverAmount] = useState(draft.surplusServings);
  const [leftoverLocation, setLeftoverLocation] = useState<StorageLocation>("fridge");

  function toggleSkip(ingredientId: IngredientId): void {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(ingredientId)) next.delete(ingredientId);
      else next.add(ingredientId);
      return next;
    });
  }

  function handleConfirm(): void {
    onConfirm({
      lines: draft.lines.map((line) => ({
        ingredientId: line.ingredientId,
        amount: amounts[line.ingredientId] ?? line.suggestedAmount,
        skip: skipped.has(line.ingredientId),
      })),
      leftover: leftoverEnabled && leftoverAmount > 0 ? { amount: leftoverAmount, location: leftoverLocation } : null,
    });
  }

  return (
    <ConfirmDialog
      open
      title={`Mark "${draft.recipeName}" cooked`}
      confirmLabel="Mark cooked"
      onConfirm={handleConfirm}
      onCancel={onCancel}
      description={
        <div className={styles.cookForm}>
          {draft.lines.length === 0 ? (
            <p>No ingredient lines on this recipe — confirming just records it as cooked.</p>
          ) : (
            draft.lines.map((line) => {
              const isSkipped = skipped.has(line.ingredientId);
              return (
                <div key={line.ingredientId} className={`${styles.cookLine}${isSkipped ? ` ${styles.cookLineSkip}` : ""}`}>
                  <div className={styles.cookLineName}>
                    <QuantityInput
                      label={line.ingredientName}
                      unit={line.unit}
                      value={amounts[line.ingredientId] ?? line.suggestedAmount}
                      disabled={isSkipped}
                      onChange={(q) =>
                        setAmounts((current) => ({ ...current, [line.ingredientId]: q?.amount ?? 0 }))
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className={`${styles.cookLineSkipButton}${isSkipped ? ` ${styles.cookLineSkipButtonActive}` : ""}`}
                    onClick={() => toggleSkip(line.ingredientId)}
                    aria-pressed={isSkipped}
                  >
                    {isSkipped ? "Skipped" : "Skip"}
                  </button>
                </div>
              );
            })
          )}

          {draft.surplusServings > 0 ? (
            <div className={styles.leftoverSection}>
              <button
                type="button"
                className={`${styles.cookLineSkipButton}${leftoverEnabled ? ` ${styles.cookLineSkipButtonActive}` : ""}`}
                aria-pressed={leftoverEnabled}
                onClick={() => setLeftoverEnabled((current) => !current)}
              >
                {leftoverEnabled ? "Save leftovers" : "No leftovers"}
              </button>
              {leftoverEnabled ? (
                <>
                  <QuantityInput
                    label="Leftover portions"
                    unit="portion"
                    value={leftoverAmount}
                    onChange={(q) => setLeftoverAmount(q?.amount ?? 0)}
                    showSteppers
                  />
                  <SegmentedControl<StorageLocation>
                    aria-label="Leftover location"
                    options={LEFTOVER_LOCATION_OPTIONS}
                    value={leftoverLocation}
                    onChange={setLeftoverLocation}
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      }
    />
  );
}
