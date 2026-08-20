import { useId, useRef, useState, type ChangeEvent } from "react";
import { useButton } from "react-aria";
import { makeQuantity, type Quantity, type Unit } from "../../domain/types.ts";
import { Minus, Plus, type IconComponent } from "../icons.ts";
import styles from "./QuantityInput.module.css";

export interface QuantityInputProps {
  readonly label: string;
  /**
   * The ingredient's single canonical unit (invariant 3, HANDOVER §4). This
   * is display-only — there is deliberately no unit `<select>` anywhere in
   * this component. A caller that wants a different unit is asking for
   * conversion, which does not exist in this app; render a second
   * `QuantityInput` for a different ingredient instead.
   */
  readonly unit: Unit;
  /** Current amount, or `null` while empty/invalid. Controlled. */
  readonly value: number | null;
  /**
   * Fires on every keystroke. Receives a full `Quantity` (amount + the fixed
   * `unit`) only when the current input is valid; otherwise `null` — a
   * caller can never receive an amount detached from its unit, and can
   * never receive a negative or non-finite amount unless `allowNegative` is
   * set.
   */
  readonly onChange: (quantity: Quantity | null) => void;
  readonly id?: string;
  readonly placeholder?: string;
  /** Uncontrolled convenience: seeds the raw text once on mount, same as a native input's `defaultValue`. Ignored if `value` is non-null. */
  readonly defaultValue?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  /**
   * Allows negative amounts — for signed corrections (`AdjustEvent.delta`)
   * only. Absolute quantities (purchases, lot amounts, recipe lines) must
   * leave this unset so negative entries are rejected.
   */
  readonly allowNegative?: boolean;
  readonly prefixIcon?: IconComponent;
  readonly suffixIcon?: IconComponent;
  /**
   * Adds +/- stepper buttons — real touch targets, never 16px spinners.
   * Sensible for `piece`, pointless for `g`/`ml` (UI_DESIGN.md §5).
   */
  readonly showSteppers?: boolean;
  /** Step size used by the steppers only; irrelevant if `showSteppers` is unset. */
  readonly step?: number;
}

function validate(
  raw: string,
  unit: Unit,
  { required, allowNegative }: { required: boolean; allowNegative: boolean },
): { quantity: Quantity | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { quantity: null, error: required ? "Enter an amount." : null };
  }
  // Accept a bare leading "." or trailing "." while typing (e.g. "0." or
  // "1,") without erroring — Number() already parses "0." as 0, but a lone
  // "." or "-" mid-entry must not show an error on every keystroke.
  if (trimmed === "." || trimmed === "-" || trimmed === "-.") {
    return { quantity: null, error: null };
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || /[^0-9.-]/.test(trimmed)) {
    return { quantity: null, error: "Enter a number." };
  }
  if (!allowNegative && amount < 0) {
    return { quantity: null, error: "Amount cannot be negative." };
  }
  return { quantity: makeQuantity(amount, unit), error: null };
}

/**
 * Amount + fixed canonical unit, honoring invariant 3. `type="text"
 * inputMode="decimal"` holding a raw STRING in state (UI_DESIGN.md §5) —
 * never `type="number"`: a scroll wheel silently changes the value, spinners
 * are tiny hit targets, it accepts `e`/`+`/`-`, and `valueAsNumber` is `NaN`
 * for partial input. Storing a number instead of the raw string is the root
 * cause of the jank `type="number"` causes anyway — the moment the user
 * types `0.` you'd parse to `NaN` and the cursor jumps. A caller only ever
 * receives a parsed `Quantity` upward via `onChange`, and only once valid.
 *
 * Rejects unit-less entries (the unit is never optional or user-selectable
 * — every valid `onChange` call carries the full `Quantity`) and rejects
 * negative entries unless `allowNegative` opts into signed-correction
 * semantics.
 */
export function QuantityInput({
  label,
  unit,
  value,
  onChange,
  id,
  placeholder,
  defaultValue,
  required = false,
  disabled = false,
  allowNegative = false,
  prefixIcon: PrefixIcon,
  suffixIcon: SuffixIcon,
  showSteppers = false,
  step = 1,
}: QuantityInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  const [raw, setRaw] = useState<string>(() => {
    if (value !== null) return String(value);
    return defaultValue ?? "";
  });
  const [error, setError] = useState<string | null>(null);

  function commit(nextRaw: string): void {
    setRaw(nextRaw);
    const result = validate(nextRaw, unit, { required, allowNegative });
    setError(result.error);
    onChange(result.quantity);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    commit(event.target.value);
  }

  function step_(direction: 1 | -1): void {
    const current = Number(raw.trim());
    const base = Number.isFinite(current) ? current : 0;
    const next = base + direction * step;
    if (!allowNegative && next < 0) return;
    commit(String(next));
  }

  return (
    <div className={styles.root}>
      <label htmlFor={inputId} className={styles.label}>
        {label} <span className={styles.unit}>({unit})</span>
      </label>
      <div className={styles.control}>
        {showSteppers ? (
          <Stepper
            icon={Minus}
            label={`Decrease ${label}`}
            disabled={disabled}
            onPress={() => step_(-1)}
          />
        ) : null}
        {PrefixIcon ? <PrefixIcon size={18} className={styles.prefixIcon} aria-hidden="true" /> : null}
        <input
          id={inputId}
          className={styles.field}
          type="text"
          inputMode="decimal"
          placeholder={placeholder}
          value={raw}
          disabled={disabled}
          required={required}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
          onChange={handleChange}
        />
        {SuffixIcon ? <SuffixIcon size={18} className={styles.suffixIcon} aria-hidden="true" /> : null}
        <span className={styles.suffix} aria-hidden="true">
          {unit}
        </span>
        {showSteppers ? (
          <Stepper icon={Plus} label={`Increase ${label}`} disabled={disabled} onPress={() => step_(1)} />
        ) : null}
      </div>
      {error !== null ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Real touch-target (--touch-target) stepper button, built on `useButton` (react-aria) — never a 16px native spinner. */
function Stepper({
  icon: Icon,
  label,
  disabled,
  onPress,
}: {
  readonly icon: IconComponent;
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton({ "aria-label": label, isDisabled: disabled, onPress }, ref);
  return (
    <button {...buttonProps} ref={ref} type="button" className={styles.stepper}>
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}
