import { useId, useState, type ChangeEvent } from "react";
import { makeQuantity, type Quantity, type Unit } from "../../domain/types.ts";
import "./QuantityInput.css";

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
  readonly required?: boolean;
  readonly disabled?: boolean;
  /**
   * Allows negative amounts — for signed corrections (`AdjustEvent.delta`)
   * only. Absolute quantities (purchases, lot amounts, recipe lines) must
   * leave this unset so negative entries are rejected.
   */
  readonly allowNegative?: boolean;
  /** Step for the native number input; fractional amounts are valid (design: "0.5 tomato"). */
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
  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return { quantity: null, error: "Enter a number." };
  }
  if (!allowNegative && amount < 0) {
    return { quantity: null, error: "Amount cannot be negative." };
  }
  return { quantity: makeQuantity(amount, unit), error: null };
}

/**
 * Amount + fixed canonical unit, honoring invariant 3. Rejects unit-less
 * entries (the unit is never optional or user-selectable — every valid
 * `onChange` call carries the full `Quantity`) and rejects negative entries
 * unless `allowNegative` opts into signed-correction semantics.
 */
export function QuantityInput({
  label,
  unit,
  value,
  onChange,
  id,
  required = false,
  disabled = false,
  allowNegative = false,
  step = 0.01,
}: QuantityInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  const [raw, setRaw] = useState<string>(value === null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextRaw = event.target.value;
    setRaw(nextRaw);
    const result = validate(nextRaw, unit, { required, allowNegative });
    setError(result.error);
    onChange(result.quantity);
  }

  return (
    <div className="quantity-input">
      <label htmlFor={inputId} className="quantity-input__label">
        {label} <span className="quantity-input__unit">({unit})</span>
      </label>
      <div className="quantity-input__control">
        <input
          id={inputId}
          className="quantity-input__field"
          type="number"
          inputMode="decimal"
          step={step}
          min={allowNegative ? undefined : 0}
          value={raw}
          disabled={disabled}
          required={required}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
          onChange={handleChange}
        />
        <span className="quantity-input__suffix" aria-hidden="true">
          {unit}
        </span>
      </div>
      {error !== null ? (
        <p id={errorId} className="quantity-input__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
