import { useRef } from "react";
import { useToggleButton } from "react-aria";
import { useToggleState } from "react-stately";
import type { IconComponent } from "../icons.ts";
import styles from "./ToggleChips.module.css";

export interface ToggleChipOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly icon?: IconComponent;
}

export interface ToggleChipsProps<V extends string> {
  /** ≤4 options, no overlay (UI_DESIGN.md §5) — meal tags are the canonical use. */
  readonly options: readonly ToggleChipOption<V>[];
  readonly value: readonly V[];
  readonly onChange: (value: readonly V[]) => void;
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
  readonly isDisabled?: boolean;
}

/**
 * Multi-select, ≤4 visible options, no overlay. Each chip is a real toggle
 * button (`useToggleButton` + `useToggleState`, react-aria/react-stately) —
 * `aria-pressed`, keyboard activation and focus management come from the
 * hook; only the visual chip markup is ours.
 */
export function ToggleChips<V extends string>({
  options,
  value,
  onChange,
  isDisabled,
  ...aria
}: ToggleChipsProps<V>) {
  return (
    <div
      className={styles.group}
      role="group"
      {...(aria["aria-label"] !== undefined ? { "aria-label": aria["aria-label"] } : {})}
      {...(aria["aria-labelledby"] !== undefined ? { "aria-labelledby": aria["aria-labelledby"] } : {})}
    >
      {options.map((option) => (
        <Chip
          key={option.value}
          option={option}
          isSelected={value.includes(option.value)}
          isDisabled={isDisabled ?? false}
          onToggle={(selected) => {
            const next = selected
              ? [...value, option.value]
              : value.filter((v) => v !== option.value);
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

function Chip<V extends string>({
  option,
  isSelected,
  isDisabled,
  onToggle,
}: {
  readonly option: ToggleChipOption<V>;
  readonly isSelected: boolean;
  readonly isDisabled: boolean;
  readonly onToggle: (selected: boolean) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // `children` is passed through so useToggleButton can see an accessible
  // name is present (the visible label text below) — without it react-aria
  // warns as if this were an unlabeled icon-only control, even though it isn't.
  const toggleProps = {
    isSelected,
    isDisabled,
    onChange: onToggle,
    children: option.label,
  };
  const state = useToggleState(toggleProps);
  const { buttonProps } = useToggleButton(toggleProps, state, ref);
  const Icon = option.icon;

  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      className={`${styles.chip}${isSelected ? ` ${styles.chipSelected}` : ""}`}
    >
      {Icon ? <Icon size={16} weight={isSelected ? "fill" : "regular"} aria-hidden="true" /> : null}
      {option.label}
    </button>
  );
}
