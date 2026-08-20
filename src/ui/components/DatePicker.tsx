import { useId, useState, type ChangeEvent } from "react";
import { makeIsoDate, type IsoDate } from "../../domain/types.ts";
import "./DatePicker.css";

export interface DatePickerProps {
  readonly label: string;
  /** `YYYY-MM-DD`, or `null` while empty/invalid. Controlled. */
  readonly value: IsoDate | null;
  readonly onChange: (date: IsoDate | null) => void;
  readonly id?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly min?: IsoDate;
  readonly max?: IsoDate;
}

/** Thin, validated wrapper around the native `<input type="date">`. */
export function DatePicker({
  label,
  value,
  onChange,
  id,
  required = false,
  disabled = false,
  min,
  max,
}: DatePickerProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const [error, setError] = useState<string | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const raw = event.target.value;
    if (raw === "") {
      setError(required ? "Choose a date." : null);
      onChange(null);
      return;
    }
    try {
      const date = makeIsoDate(raw);
      setError(null);
      onChange(date);
    } catch {
      setError("Enter a valid date.");
      onChange(null);
    }
  }

  return (
    <div className="date-picker">
      <label htmlFor={inputId} className="date-picker__label">
        {label}
      </label>
      <input
        id={inputId}
        className="date-picker__field"
        type="date"
        value={value ?? ""}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        onChange={handleChange}
      />
      {error !== null ? (
        <p id={errorId} className="date-picker__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
