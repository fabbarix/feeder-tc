import { useId, useRef, useState } from "react";
import { DismissButton, FocusScope, useButton, useOverlay } from "react-aria";
import type { IsoDate } from "../../domain/types.ts";
import { Calendar } from "./dates/Calendar.tsx";
import { CaretDown, type IconComponent } from "../icons.ts";
import styles from "./DateChips.module.css";

export interface DateChipOption {
  readonly label: string;
  readonly date: IsoDate;
}

export interface DateChipsProps {
  readonly label: string;
  /** Preset chips — caller supplies the label/date pairs (`Today`/`Yesterday`, `+3d`/`+1w`/`+1m`, `This week`/`Next week`/…). See UI_DESIGN.md §5 "Dates". */
  readonly options: readonly DateChipOption[];
  readonly value: IsoDate | null;
  readonly onChange: (date: IsoDate) => void;
  /** Adds a trailing "Pick…" chip that opens the React Aria calendar — the escape hatch, not the primary control. */
  readonly allowPick?: boolean;
  readonly minValue?: IsoDate;
  readonly maxValue?: IsoDate;
}

/**
 * Context-shaped date control (UI_DESIGN.md §5 "Dates"): preset chips plus
 * an optional `Pick…` escape hatch. Relative offsets read better than a
 * calendar for shelf life ("lasts about a week"), so they are the primary
 * UI; `Pick…` opens `Calendar` (React Aria) in a lightweight popover built
 * on `useOverlay` + `FocusScope` (dismiss-on-outside-click, Escape-to-close,
 * focus containment). Speaks `IsoDate` only, never a JS `Date`.
 */
export function DateChips({
  label,
  options,
  value,
  onChange,
  allowPick = false,
  minValue,
  maxValue,
}: DateChipsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const groupLabelId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);

  const { overlayProps } = useOverlay(
    { isOpen: pickerOpen, onClose: () => setPickerOpen(false), isDismissable: true, shouldCloseOnBlur: true },
    overlayRef,
  );

  const isPickedValue = value !== null && !options.some((option) => option.date === value);

  return (
    <div className={styles.root}>
      <span id={groupLabelId} className={styles.label}>
        {label}
      </span>
      <div className={styles.chips} role="group" aria-labelledby={groupLabelId}>
        {options.map((option) => (
          <Chip
            key={option.label}
            label={option.label}
            isSelected={value === option.date}
            onPress={() => {
              setPickerOpen(false);
              onChange(option.date);
            }}
          />
        ))}
        {allowPick ? (
          <div className={styles.pickWrap}>
            <Chip
              label="Pick…"
              isSelected={pickerOpen || isPickedValue}
              icon={CaretDown}
              onPress={() => setPickerOpen((open) => !open)}
            />
            {pickerOpen ? (
              <FocusScope contain restoreFocus autoFocus>
                <div {...overlayProps} ref={overlayRef} className={styles.popover}>
                  <DismissButton onDismiss={() => setPickerOpen(false)} />
                  <Calendar
                    aria-label={label}
                    value={value}
                    onChange={(date) => {
                      onChange(date);
                      setPickerOpen(false);
                    }}
                    {...(minValue !== undefined ? { minValue } : {})}
                    {...(maxValue !== undefined ? { maxValue } : {})}
                  />
                  <DismissButton onDismiss={() => setPickerOpen(false)} />
                </div>
              </FocusScope>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Chip({
  label,
  isSelected,
  icon: Icon,
  onPress,
}: {
  readonly label: string;
  readonly isSelected: boolean;
  readonly icon?: IconComponent;
  readonly onPress: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton({ onPress }, ref);
  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      aria-pressed={isSelected}
      className={`${styles.chip}${isSelected ? ` ${styles.chipSelected}` : ""}`}
    >
      {label}
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
    </button>
  );
}
