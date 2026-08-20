/**
 * A minimal whole-number text field, following the same discipline as the
 * kit's `QuantityInput` (UI_DESIGN.md §5 "Numbers") for values that aren't a
 * domain `Quantity` — servings, prep/cook minutes, shelf-life days. Kept
 * here rather than in `src/ui/**` because it has no unit and no invariant-3
 * story; promoting it to the kit would just be a second, slightly different
 * number input next to `QuantityInput`.
 *
 * `type="text" inputMode="numeric"`, raw string in state, only a fully valid
 * non-negative integer is ever propagated upward — never `type="number"`
 * (scroll-wheel jank, tiny spinners, accepts `e`/`+`/`-`, `valueAsNumber` is
 * `NaN` mid-edit).
 */
import { useId, useState, type ChangeEvent } from "react";
import styles from "./forms.module.css";

export interface IntegerFieldProps {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly min?: number;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly suffix?: string;
}

export function IntegerField({
  label,
  value,
  onChange,
  min = 0,
  required = false,
  disabled = false,
  id,
  suffix,
}: IntegerFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [raw, setRaw] = useState<string>(() => (value !== null ? String(value) : ""));

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    setRaw(next);
    if (next.trim() === "") {
      onChange(null);
      return;
    }
    if (!/^\d+$/.test(next.trim())) {
      // Invalid partial input (e.g. stray characters) — don't propagate a
      // bogus value upward, but let the user keep typing/correcting.
      return;
    }
    const parsed = Number(next.trim());
    onChange(parsed >= min ? parsed : null);
  }

  return (
    <div className={styles.field}>
      <label htmlFor={inputId}>
        {label}
        {suffix ? ` (${suffix})` : ""}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        value={raw}
        disabled={disabled}
        required={required}
        onChange={handleChange}
      />
    </div>
  );
}

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly required?: boolean;
  readonly id?: string;
  readonly placeholder?: string;
}

export function TextField({ label, value, onChange, required = false, id, placeholder }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="text"
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
