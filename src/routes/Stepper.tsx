import { Minus, Plus } from "../ui/icons.ts";
import forms from "./forms.module.css";

export interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly min?: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}

/**
 * A whole-number +/- stepper for a value that isn't a domain `Quantity`
 * (household size in "people", the repeat-exclusion window in "weeks",
 * servings/prep/cook minutes on the recipe editor) — `QuantityInput`'s
 * `unit` is fixed to the canonical `Unit` union (invariant 3) and none of
 * those is one, so this is the shared, promoted control every non-`Unit`
 * numeric field in the app uses (`.qty`/`.qtyValue`/`.qtyUnit` markup from
 * `forms.module.css`) rather than each screen force-fitting `QuantityInput`
 * or inventing its own stepper (WP-VC4 promoted this out of
 * `routes/settings/Stepper.tsx`, its original single caller, once
 * RecipeEditor.tsx needed the exact same control for three fields instead
 * of a mix of a stepper, a plain number box and a sentence).
 */
export function Stepper({ label, value, unit, min = 0, disabled = false, onChange }: StepperProps) {
  return (
    <div className={forms.field}>
      <span className={forms.fieldLabel}>{label}</span>
      <div className={`${forms.qty}${disabled ? ` ${forms.qtyDisabled}` : ""}`}>
        <button
          type="button"
          aria-label={`Fewer — ${label}`}
          disabled={disabled}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <span className={forms.qtyValue}>
          {value} <span className={forms.qtyUnit}>{unit}</span>
        </span>
        <button
          type="button"
          aria-label={`More — ${label}`}
          disabled={disabled}
          onClick={() => onChange(value + 1)}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
