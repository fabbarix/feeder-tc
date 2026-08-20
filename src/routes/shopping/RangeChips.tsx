import { useRef, useState } from "react";
import { DismissButton, FocusScope, useButton, useOverlay } from "react-aria";
import { Calendar } from "../../ui/components";
import { compareIsoDate, type DateRange, type IsoDate } from "../../domain/index.ts";
import { RANGE_PRESET_OPTIONS, rangeForPreset, type ShoppingRangePreset } from "./range.ts";
import styles from "./RangeChips.module.css";

export interface RangeChipsProps {
  readonly today: IsoDate;
  readonly preset: ShoppingRangePreset;
  readonly range: DateRange;
  readonly onChange: (preset: ShoppingRangePreset, range: DateRange) => void;
}

/**
 * The shopping range picker (UI_DESIGN.md §5 "Shopping range" — preset
 * chips, never a date picker as the primary control). Four fixed-length
 * presets always render; "Custom range…" is a desktop-only escape hatch
 * (see RangeChips.module.css's `.customChip`) that opens two calendars
 * (`ui/components/dates/Calendar.tsx`, the same React Aria calendar every
 * `Pick…` chip in the app uses) for a start/end date, matching the mock's
 * "Custom range…" note that it "reveals the same calendar" rather than a
 * bespoke range-selection control.
 */
export function RangeChips({ today, preset, range, onChange }: RangeChipsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<IsoDate | null>(preset === "custom" ? range.start : null);
  const [draftEnd, setDraftEnd] = useState<IsoDate | null>(preset === "custom" ? range.end : null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const { overlayProps } = useOverlay(
    { isOpen: pickerOpen, onClose: () => setPickerOpen(false), isDismissable: true, shouldCloseOnBlur: true },
    overlayRef,
  );

  const canApply = draftStart !== null && draftEnd !== null && compareIsoDate(draftStart, draftEnd) <= 0;

  function openCustom(): void {
    setDraftStart(preset === "custom" ? range.start : null);
    setDraftEnd(preset === "custom" ? range.end : null);
    setPickerOpen((open) => !open);
  }

  function applyCustom(): void {
    if (draftStart === null || draftEnd === null || compareIsoDate(draftStart, draftEnd) > 0) return;
    onChange("custom", { start: draftStart, end: draftEnd });
    setPickerOpen(false);
  }

  return (
    <div className={styles.root}>
      <div className={styles.chips} role="group" aria-label="Shopping range">
        {RANGE_PRESET_OPTIONS.map((option) => (
          <Chip
            key={option.preset}
            label={option.label}
            isSelected={preset === option.preset}
            onPress={() => onChange(option.preset, rangeForPreset(option.preset, today))}
          />
        ))}
        <div className={styles.pickWrap}>
          <button
            type="button"
            aria-pressed={preset === "custom"}
            className={`${styles.chip} ${styles.customChip}${preset === "custom" ? ` ${styles.chipSelected}` : ""}`}
            onClick={openCustom}
          >
            Custom range…
          </button>
          {pickerOpen ? (
            <FocusScope contain restoreFocus autoFocus>
              <div {...overlayProps} ref={overlayRef} className={styles.popover}>
                <DismissButton onDismiss={() => setPickerOpen(false)} />
                <div className={styles.popoverCalendars}>
                  <div className={styles.popoverField}>
                    <span className={styles.popoverLabel}>From</span>
                    <Calendar aria-label="Custom range start" value={draftStart} onChange={setDraftStart} />
                  </div>
                  <div className={styles.popoverField}>
                    <span className={styles.popoverLabel}>To</span>
                    <Calendar
                      aria-label="Custom range end"
                      value={draftEnd}
                      onChange={setDraftEnd}
                      {...(draftStart !== null ? { minValue: draftStart } : {})}
                    />
                  </div>
                </div>
                <div className={styles.popoverActions}>
                  <button type="button" className={styles.applyButton} disabled={!canApply} onClick={applyCustom}>
                    Apply
                  </button>
                </div>
                <DismissButton onDismiss={() => setPickerOpen(false)} />
              </div>
            </FocusScope>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Chip({
  label,
  isSelected,
  onPress,
}: {
  readonly label: string;
  readonly isSelected: boolean;
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
    </button>
  );
}
