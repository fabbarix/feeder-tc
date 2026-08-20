import { useRef } from "react";
import { useRadio, useRadioGroup, type AriaRadioGroupProps, type AriaRadioProps } from "react-aria";
import { useRadioGroupState, type RadioGroupState } from "react-stately";
import { createContext, useContext } from "react";
import type { IconComponent } from "../icons.ts";
import styles from "./SegmentedControl.module.css";

export interface SegmentedControlOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly icon?: IconComponent;
}

export interface SegmentedControlProps<V extends string> {
  /**
   * Options rendered inline, no overlay (UI_DESIGN.md §5 "Selection"). Keep
   * this at 4 or fewer — past that, use `SelectSheet` instead of growing a
   * segmented control.
   */
  readonly options: readonly SegmentedControlOption<V>[];
  readonly value: V;
  readonly onChange: (value: V) => void;
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
  readonly isDisabled?: boolean;
}

const RadioGroupStateContext = createContext<RadioGroupState | undefined>(undefined);

/**
 * Single-select, ≤4 visible options, no overlay — storage location, recipe
 * kind, the 3-state vote control, meal tags, slot layout (UI_DESIGN.md §5).
 * Built on `useRadioGroup`/`useRadio` (react-aria) + `useRadioGroupState`
 * (react-stately): real radio-group semantics (roving tabindex, arrow-key
 * navigation, `role="radiogroup"`), rendered as our own segmented-button
 * markup rather than native radio inputs.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  isDisabled,
  ...aria
}: SegmentedControlProps<V>) {
  const groupProps: AriaRadioGroupProps = {
    value,
    onChange: (next: string) => onChange(next as V),
    orientation: "horizontal",
    ...(isDisabled !== undefined ? { isDisabled } : {}),
    ...(aria["aria-label"] !== undefined ? { "aria-label": aria["aria-label"] } : {}),
    ...(aria["aria-labelledby"] !== undefined ? { "aria-labelledby": aria["aria-labelledby"] } : {}),
  };
  const state = useRadioGroupState(groupProps);
  const { radioGroupProps } = useRadioGroup(groupProps, state);

  return (
    <div {...radioGroupProps} className={styles.group}>
      <RadioGroupStateContext.Provider value={state}>
        {options.map((option) => (
          <Segment key={option.value} option={option} />
        ))}
      </RadioGroupStateContext.Provider>
    </div>
  );
}

function Segment<V extends string>({ option }: { readonly option: SegmentedControlOption<V> }) {
  const state = useContext(RadioGroupStateContext);
  if (!state) throw new Error("Segment must be rendered inside SegmentedControl");
  const ref = useRef<HTMLInputElement>(null);
  // `children` is passed through so useRadio can see an accessible name is
  // present (the visible <span> below) — without it react-aria warns as if
  // this were an unlabeled icon-only control, even though it isn't.
  const radioProps: AriaRadioProps = { value: option.value, children: option.label };
  const { inputProps, isSelected, isDisabled } = useRadio(radioProps, state, ref);
  const Icon = option.icon;

  return (
    <label
      className={`${styles.segment}${isSelected ? ` ${styles.segmentSelected}` : ""}${
        isDisabled ? ` ${styles.segmentDisabled}` : ""
      }`}
    >
      <input {...inputProps} ref={ref} className={styles.input} />
      {Icon ? <Icon size={18} weight={isSelected ? "fill" : "regular"} aria-hidden="true" /> : null}
      <span>{option.label}</span>
    </label>
  );
}
