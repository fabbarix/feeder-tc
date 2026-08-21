/**
 * The scan/check-off "need → buy" quantity control (M6, coordinator's
 * additional requirement 2026-08-21 — variable-weight items are first-class,
 * not an edge case). Naming follows `DESIGN_PURCHASING.md` §2 ("need" / "buy"
 * / "surplus") so this seam merges cleanly with that package's own general
 * shopping-row stepper once it lands — see this route's own doc comment
 * (Scan.tsx) for exactly where the seam is expected to fall.
 *
 * Two shapes, one control (requirement: "reuse the same control ... not a
 * second idiom"):
 *
 *  - A known default exists (the list's need, or a packaged product's usual
 *    size) → show it as the headline, no typing required — a single tap on
 *    the confirm button below buys exactly that. "Bought a different
 *    amount?" is a low-emphasis, one-tap reveal, never a buried form.
 *  - No default exists (a bulk/variable-weight item with no matching need)
 *    → the amount field is shown open immediately, because there is
 *    genuinely nothing to default to — the shopper must weigh it. This is
 *    the SAME `QuantityInput` (with steppers), not a separate "ask the
 *    weight" form.
 *
 * `showSteppers` on `QuantityInput` (already in the kit — UI_DESIGN.md §5)
 * is the "fast, one-tap-to-adjust" affordance requirement 2 asks for; no new
 * kit component was added for this.
 */
import { useState } from "react";
import { QuantityInput } from "../../ui/components";
import { formatQuantity, type Quantity, type Unit } from "../../domain/index.ts";
import styles from "./scan.module.css";

export interface BuyQuantityControlProps {
  readonly label: string;
  readonly unit: Unit;
  /** The "need" (a live shopping-list line) or a sensible fallback (a packaged product's usual size) — `null` means there is genuinely no default. */
  readonly defaultQuantity: Quantity | null;
  /** Forces the amount field open immediately — bulk/variable-weight items, which have no fixed size to default to every scan. */
  readonly forceOpen?: boolean;
  readonly amount: number | null;
  readonly onChange: (amount: number | null) => void;
}

/**
 * `revealed`'s initial value is computed once, from the FIRST render's
 * props, and deliberately never reset by an effect afterwards: the parent
 * (`KnownProductFlow`) is itself freshly mounted per scan (see that
 * component's own doc comment), so this component never sees
 * `defaultQuantity`/`forceOpen` change mid-lifetime — there is no "new scan
 * while still mounted" case to reset for.
 */
export function BuyQuantityControl({ label, unit, defaultQuantity, forceOpen = false, amount, onChange }: BuyQuantityControlProps) {
  const [revealed, setRevealed] = useState(() => forceOpen || defaultQuantity === null);

  if (!revealed && defaultQuantity !== null) {
    return (
      <div className={styles.buyDefault}>
        <span className={styles.buyDefaultLabel}>{label}</span>
        <p className={styles.buyDefaultAmount}>{formatQuantity(defaultQuantity)}</p>
        <button type="button" className={styles.buyAdjustLink} onClick={() => setRevealed(true)}>
          Bought a different amount?
        </button>
      </div>
    );
  }

  return (
    <QuantityInput
      label={label}
      unit={unit}
      value={amount}
      onChange={(q) => onChange(q?.amount ?? null)}
      showSteppers
      required
    />
  );
}
