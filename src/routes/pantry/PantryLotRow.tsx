import { useState } from "react";
import {
  ConfirmDialog,
  DateChips,
  FreshnessMeter,
  ListRow,
  QuantityInput,
  SegmentedControl,
} from "../../ui/components";
import { Snowflake, Trash } from "../../ui/icons";
import { daysBetween, formatQuantity, makeQuantity } from "../../domain/index.ts";
import type { Ingredient, IsoDate, Lot, Quantity, StorageLocation } from "../../domain/index.ts";
import { TextField } from "../fields.tsx";
import { LOCATION_OPTIONS, expiryOverrideOptions, locationLabel } from "./pantry-options.ts";
import styles from "./pantry.module.css";

export interface PantryLotRowProps {
  readonly lot: Lot;
  readonly ingredient: Ingredient;
  readonly today: IsoDate;
  readonly failed: boolean;
  readonly onRetryFailed: () => void;
  readonly onOpen: () => void;
  readonly onMove: (location: StorageLocation) => void;
  readonly onSpoil: (quantity: Quantity) => void;
  readonly onCorrect: (input: { delta?: Quantity; expiry?: IsoDate; reason?: string }) => void;
}

function expiryText(daysLeft: number, expiry: IsoDate): string {
  if (daysLeft < 0) return `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} ago (${expiry})`;
  if (daysLeft === 0) return `Expires today (${expiry})`;
  return `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${expiry})`;
}

type ActiveAction = "open" | "move" | "spoil" | "correct" | null;

/**
 * One lot: quantity/location/purchase/expiry, a freshness meter (unless
 * frozen — expiry is suspended, so a countdown would be misleading), and
 * the four lot-scoped manual actions (open/move/spoil/correct — "use" is
 * ingredient-level, not lot-level, since FIFO picks the lot; see
 * `Pantry.tsx`). Each action opens the SAME `ConfirmDialog` (UI_DESIGN.md §5
 * bans `window.confirm`) with a small embedded form as its `description`.
 */
export function PantryLotRow({
  lot,
  ingredient,
  today,
  failed,
  onRetryFailed,
  onOpen,
  onMove,
  onSpoil,
  onCorrect,
}: PantryLotRowProps) {
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [moveTarget, setMoveTarget] = useState<StorageLocation>(lot.location);
  const [spoilAmount, setSpoilAmount] = useState<number | null>(lot.quantity.amount);
  const [correctDelta, setCorrectDelta] = useState<number | null>(null);
  const [correctExpiry, setCorrectExpiry] = useState<IsoDate | null>(null);
  const [correctReason, setCorrectReason] = useState("");

  const frozen = lot.location === "freezer";
  const daysLeft = daysBetween(today, lot.expiry);
  const tone = daysLeft < 0 ? styles.expiryCrit : daysLeft <= 3 ? styles.expiryWarn : styles.expiryText;

  const reference = lot.openedAt ?? lot.purchaseDate;
  const totalDays = Math.max(1, daysBetween(reference, lot.expiry));
  const fraction = daysBetween(today, lot.expiry) / totalDays;

  function closeDialog(): void {
    setActiveAction(null);
  }

  function openMoveDialog(): void {
    setMoveTarget(lot.location);
    setActiveAction("move");
  }

  function openSpoilDialog(): void {
    setSpoilAmount(lot.quantity.amount);
    setActiveAction("spoil");
  }

  function openCorrectDialog(): void {
    setCorrectDelta(null);
    setCorrectExpiry(null);
    setCorrectReason("");
    setActiveAction("correct");
  }

  return (
    <>
      <ListRow
        leading={frozen ? <Snowflake size={20} aria-hidden="true" /> : undefined}
        primary={ingredient.name}
        secondary={
          <div className={styles.lotDetail}>
            <span>
              {formatQuantity(lot.quantity)} · {locationLabel(lot.location)} · purchased {lot.purchaseDate}
              {lot.openedAt ? ` · opened ${lot.openedAt}` : ""}
            </span>
            {frozen ? (
              <span className={styles.frozenBadge}>
                <Snowflake size={14} aria-hidden="true" />
                Frozen — expiry paused
              </span>
            ) : (
              <>
                <span className={tone}>{expiryText(daysLeft, lot.expiry)}</span>
                <div className={styles.meter}>
                  <FreshnessMeter
                    fractionRemaining={fraction}
                    label={daysLeft >= 0 ? `${daysLeft} of ${totalDays} days remaining` : "Expired"}
                  />
                </div>
              </>
            )}
          </div>
        }
        trailing={
          <div className={styles.actions}>
            {lot.openedAt === undefined ? (
              <button type="button" className={styles.actionButton} onClick={() => setActiveAction("open")}>
                Open
              </button>
            ) : null}
            <button type="button" className={styles.actionButton} onClick={openMoveDialog}>
              Move
            </button>
            <button type="button" className={`${styles.actionButton} ${styles.actionButtonDestructive}`} onClick={openSpoilDialog}>
              <Trash size={14} aria-hidden="true" />
              Spoil
            </button>
            <button type="button" className={styles.actionButton} onClick={openCorrectDialog}>
              Correct
            </button>
          </div>
        }
        failed={failed}
        {...(failed ? { onRetry: onRetryFailed } : {})}
      />

      <ConfirmDialog
        open={activeAction === "move"}
        title={`Move ${ingredient.name}`}
        description={
          <div className={styles.dialogForm}>
            <SegmentedControl<StorageLocation>
              aria-label="New location"
              options={LOCATION_OPTIONS}
              value={moveTarget}
              onChange={setMoveTarget}
            />
          </div>
        }
        confirmLabel="Confirm move"
        onConfirm={() => {
          if (moveTarget !== lot.location) onMove(moveTarget);
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={activeAction === "spoil"}
        title={`Mark ${ingredient.name} spoiled`}
        destructive
        description={
          <div className={styles.dialogForm}>
            <p className={styles.dialogHint}>How much of this lot spoiled? Defaults to the full remaining amount.</p>
            <QuantityInput
              label="Amount"
              unit={ingredient.unit}
              value={spoilAmount}
              onChange={(q) => setSpoilAmount(q?.amount ?? null)}
              required
            />
          </div>
        }
        confirmLabel="Mark spoiled"
        onConfirm={() => {
          if (spoilAmount === null || spoilAmount <= 0) return;
          onSpoil(makeQuantity(spoilAmount, ingredient.unit));
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={activeAction === "correct"}
        title={`Correct ${ingredient.name}`}
        description={
          <div className={styles.dialogForm}>
            <p className={styles.dialogHint}>
              History is never edited (invariant 1) — this records a new correction on top. Enter an amount and/or
              pick a new expiry; at least one is required.
            </p>
            <QuantityInput
              label="Adjust amount by"
              unit={ingredient.unit}
              value={correctDelta}
              onChange={(q) => setCorrectDelta(q?.amount ?? null)}
              allowNegative
              placeholder="e.g. -50 or 20"
            />
            <DateChips
              label="New expiry"
              options={expiryOverrideOptions(today)}
              value={correctExpiry}
              onChange={setCorrectExpiry}
              allowPick
            />
            <TextField label="Reason (optional)" value={correctReason} onChange={setCorrectReason} />
          </div>
        }
        confirmLabel="Save correction"
        onConfirm={() => {
          if (correctDelta === null && correctExpiry === null) return;
          onCorrect({
            ...(correctDelta !== null ? { delta: makeQuantity(correctDelta, ingredient.unit) } : {}),
            ...(correctExpiry !== null ? { expiry: correctExpiry } : {}),
            ...(correctReason.trim() !== "" ? { reason: correctReason.trim() } : {}),
          });
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={activeAction === "open"}
        title={`Open ${ingredient.name}?`}
        description={
          frozen
            ? "Still frozen — the shorter opened shelf life starts counting once it's thawed."
            : `Shelf life shortens to the opened default (${ingredient.openedShelfLifeDays} days) from today.`
        }
        confirmLabel="Mark opened"
        onConfirm={() => {
          onOpen();
          closeDialog();
        }}
        onCancel={closeDialog}
      />
    </>
  );
}
