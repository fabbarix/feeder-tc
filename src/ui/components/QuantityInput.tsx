import { useId, useRef, useState, type ChangeEvent } from "react";
import { useButton } from "react-aria";
import type { Unit } from "../../domain/types.ts";
import { Minus, Plus, type IconComponent } from "../icons.ts";
import { Tooltip } from "./Tooltip.tsx";
import styles from "./QuantityInput.module.css";

/**
 * Generic over its unit label — defaults to the domain `Unit` union
 * (invariant 3: an ingredient's canonical unit) but a caller may pass any
 * fixed string label instead (WP-VC4: the recipe editor's Servings/Prep
 * time/Cook time fields, none of which are a domain `Quantity` — "min" and
 * "servings" are not in `Unit`). `{ amount, unit: U }` is returned rather
 * than the domain `Quantity` type so this stays usable for both: when
 * `U` is `Unit`, that shape IS `Quantity` structurally, so every existing
 * Unit-typed caller is unaffected.
 */
export interface QuantityInputProps<U extends string = Unit> {
  readonly label: string;
  /**
   * The fixed unit this field always holds (invariant 3, HANDOVER §4, for
   * the `Unit` case). This is display-only — there is deliberately no unit
   * `<select>` anywhere in this component. A caller that wants a different
   * unit is asking for conversion, which does not exist in this app;
   * render a second `QuantityInput` for a different ingredient instead.
   */
  readonly unit: U;
  /**
   * Singular form of `unit`, shown when the amount is exactly 1. Optional:
   * the canonical units this field usually carries ("g", "ml") do not
   * inflect, but a generic caller can pass a word that does — the recipe
   * editor's servings field rendered "1 servings" until this existed.
   */
  readonly unitOne?: string;
  /** Current amount, or `null` while empty/invalid. Controlled. */
  readonly value: number | null;
  /**
   * Fires on every keystroke. Receives `{ amount, unit }` (amount + the
   * fixed `unit`) only when the current input is valid; otherwise `null` —
   * a caller can never receive an amount detached from its unit, and can
   * never receive a negative or non-finite amount unless `allowNegative` is
   * set.
   */
  readonly onChange: (quantity: { amount: number; unit: U } | null) => void;
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

function validate<U extends string>(
  raw: string,
  unit: U,
  { required, allowNegative }: { required: boolean; allowNegative: boolean },
): { quantity: { amount: number; unit: U } | null; error: string | null } {
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
  // Not `makeQuantity` (that constructor is fixed to the domain `Unit`
  // union) — finiteness is already checked above, so a plain object of the
  // same shape is equally valid, generic `U` included.
  return { quantity: { amount, unit }, error: null };
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
export function QuantityInput<U extends string = Unit>({
  label,
  unit,
  unitOne,
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
}: QuantityInputProps<U>) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const suffixId = `${inputId}-unit`;

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
        {label}
      </label>
      <div className={styles.control}>
        {showSteppers ? (
          <Stepper
            icon={Minus}
            label={`Decrease ${label}`}
            disabled={disabled}
            onPress={() => step_(-1)}
            edge="start"
          />
        ) : null}
        {PrefixIcon ? (
          <PrefixIcon size={18} className={styles.prefixIcon} aria-hidden="true" />
        ) : null}
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
          aria-describedby={error !== null ? `${suffixId} ${errorId}` : suffixId}
          onChange={handleChange}
        />
        {SuffixIcon ? (
          <SuffixIcon size={18} className={styles.suffixIcon} aria-hidden="true" />
        ) : null}
        <span id={suffixId} className={styles.suffix}>
          {value === 1 && unitOne !== undefined ? unitOne : unit}
        </span>
        {showSteppers ? (
          <Stepper
            icon={Plus}
            label={`Increase ${label}`}
            disabled={disabled}
            onPress={() => step_(1)}
            edge="end"
          />
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

/**
 * Real touch-target (--touch-target) stepper button, built on `useButton`
 * (react-aria) — never a 16px native spinner.
 *
 * `edge` picks which side of `.control` this button is flush against
 * ("start" = decrease, on the left; "end" = increase, on the right) and is
 * rendered as `data-edge` for `QuantityInput.module.css` to key its
 * flush-margin rules on. This is deliberately NOT `:first-child`/
 * `:last-child`: `Tooltip` wraps each button in its own `<span class="wrap">
 * {button}<span class="bubble"/></span>`, so every stepper button is the
 * first child of ITS OWN parent and none is ever the last child — those
 * pseudo-classes silently matched only the "first-child" rule for BOTH
 * buttons, which pulled the increase button 16px further left than
 * intended and clipped it into the unit suffix (the "servings"/"min"
 * clipping bug). An explicit attribute survives any future wrapper.
 */
function Stepper({
  icon: Icon,
  label,
  disabled,
  onPress,
  edge,
}: {
  readonly icon: IconComponent;
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly edge: "start" | "end";
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton({ "aria-label": label, isDisabled: disabled, onPress }, ref);
  return (
    <Tooltip label={label}>
      <button {...buttonProps} ref={ref} type="button" className={styles.stepper} data-edge={edge}>
        <Icon size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
