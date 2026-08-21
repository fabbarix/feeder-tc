import { Minus, Plus } from "../../ui/icons.ts";
import forms from "../forms.module.css";

export interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly min?: number;
  readonly onChange: (value: number) => void;
}

/**
 * A whole-number +/- stepper for a value that isn't a domain `Quantity`
 * (household size in "people", the repeat-exclusion window in "weeks") —
 * `QuantityInput`'s `unit` is fixed to the canonical `Unit` union
 * (invariant 3) and neither of those is one, so this follows
 * `RecipeEditor.tsx`'s own local `ServingsStepper` precedent (same
 * `.qty`/`.qtyValue`/`.qtyUnit` markup from `forms.module.css`) rather than
 * force-fitting `QuantityInput`.
 */
export function Stepper({ label, value, unit, min = 0, onChange }: StepperProps) {
  return (
    <div className={forms.field}>
      <span className={forms.fieldLabel}>{label}</span>
      <div className={forms.qty}>
        <button type="button" aria-label={`Fewer — ${label}`} onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus size={16} aria-hidden="true" />
        </button>
        <span className={forms.qtyValue}>
          {value} <span className={forms.qtyUnit}>{unit}</span>
        </span>
        <button type="button" aria-label={`More — ${label}`} onClick={() => onChange(value + 1)}>
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
