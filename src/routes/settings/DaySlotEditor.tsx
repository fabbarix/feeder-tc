import { MEAL_TAG_OPTIONS } from "../recipe-options.ts";
import type { MealTag, Weekday } from "../../domain/index.ts";
import styles from "./settings.module.css";

const DAY_SHORT_LABELS: Record<Weekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export interface DaySlotEditorProps {
  readonly day: Weekday;
  readonly slots: readonly MealTag[];
  readonly onAdd: (tag: MealTag) => void;
  readonly onRemove: (index: number) => void;
}

/**
 * One weekday's row in the slot-layout editor (WP-22): one toggle per meal
 * type, always in the same order, so a week reads as a grid and every row
 * fits one line on a phone (2026-10-10 Settings redesign — it used to be
 * removable chips plus an "+ add" menu, which wrapped to two lines).
 *
 * A day may still carry a repeated tag (two snacks) from an older layout:
 * the toggle shows the count, and tapping it removes one — the last one, so
 * removal stays positional (`withSlotRemoved`). Adding a repeat is no longer
 * offered here.
 */
export function DaySlotEditor({ day, slots, onAdd, onRemove }: DaySlotEditorProps) {
  const label = DAY_SHORT_LABELS[day];

  return (
    <div className={styles.daylay} role="group" aria-label={label}>
      <span className={styles.dayLabel} aria-hidden="true">
        {label}
      </span>
      <div className={styles.slotchips}>
        {MEAL_TAG_OPTIONS.map((option) => {
          const count = slots.filter((tag) => tag === option.value).length;
          const on = count > 0;
          return (
            <button
              key={option.value}
              type="button"
              className={on ? styles.slotchip : styles.slotchipAdd}
              aria-pressed={on}
              aria-label={`${option.label} on ${label}${count > 1 ? ` (${count})` : ""}`}
              onClick={() => (on ? onRemove(slots.lastIndexOf(option.value)) : onAdd(option.value))}
            >
              {option.label}
              {count > 1 ? <span className={styles.slotCount}>×{count}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
