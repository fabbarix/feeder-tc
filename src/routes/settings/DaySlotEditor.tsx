import { useState } from "react";
import { MEAL_TAG_OPTIONS } from "../recipe-options.ts";
import { X } from "../../ui/icons.ts";
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
 * One weekday's row in the slot-layout editor (WP-22, design/mock-
 * screens.html Settings section: "toggle chips per day"). Existing slots
 * are removable chips (a day may repeat a tag — two snacks — so removal is
 * positional); "+ add" expands into the four meal-tag options rather than
 * opening a full picker, since there are only ever four.
 */
export function DaySlotEditor({ day, slots, onAdd, onRemove }: DaySlotEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const label = DAY_SHORT_LABELS[day];

  return (
    <div className={styles.daylay}>
      <span className={styles.dayLabel}>{label}</span>
      <div className={styles.slotchips}>
        {slots.map((tag, index) => (
          <button
            key={`${tag}-${index}`}
            type="button"
            className={styles.slotchip}
            onClick={() => onRemove(index)}
            aria-label={`Remove ${MEAL_TAG_OPTIONS.find((o) => o.value === tag)?.label ?? tag} on ${label}`}
          >
            {MEAL_TAG_OPTIONS.find((o) => o.value === tag)?.label ?? tag}
            <X size={11} aria-hidden="true" />
          </button>
        ))}
        {expanded ? (
          <div className={styles.tagRow} role="group" aria-label={`Add a meal slot on ${label}`}>
            {MEAL_TAG_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.slotchipAdd}
                onClick={() => {
                  onAdd(option.value);
                  setExpanded(false);
                }}
              >
                + {option.label}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            className={styles.slotchipAdd}
            onClick={() => setExpanded(true)}
            aria-label={`Add a meal slot on ${label}`}
          >
            + add
          </button>
        )}
      </div>
    </div>
  );
}
