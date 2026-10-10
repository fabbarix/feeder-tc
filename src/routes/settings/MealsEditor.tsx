import { mealTypesOf, type MealTag, type MealType, type Settings, type Weekday } from "../../domain/index.ts";
import { Minus, PencilSimple, Plus } from "../../ui/icons.ts";
import { WEEKDAY_ORDER, dayCounts, perDayCount, type SlotsByDay } from "./slot-layout.ts";
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

/** Most slots of one meal type a single day can have — enough for "three snacks", not a typo's 30. */
export const MAX_PER_DAY = 6;

export interface MealsEditorProps {
  readonly settings: Settings;
  readonly byDay: SlotsByDay;
  readonly onToggleDay: (tag: MealTag, day: Weekday) => void;
  readonly onPerDayCount: (tag: MealTag, count: number) => void;
  readonly onEdit: (type: MealType) => void;
  readonly onAdd: () => void;
}

/**
 * The weekly meal layout as a grid (custom meal types, 2026-10-10): one row
 * per household meal type, in its own order — its name (tap to edit), how
 * many of it a day gets, and a toggle per weekday. Rows go down the page, so
 * any number of meal types fits a phone; the seven toggles always fit one
 * line.
 */
export function MealsEditor({ settings, byDay, onToggleDay, onPerDayCount, onEdit, onAdd }: MealsEditorProps) {
  const mealTypes = mealTypesOf(settings);
  return (
    <>
      {mealTypes.map((type) => {
        const counts = dayCounts(byDay, type.id);
        const perDay = perDayCount(counts);
        return (
          <div key={type.id} className={styles.mealRow} role="group" aria-label={type.name}>
            <div className={styles.mealHead}>
              <button
                type="button"
                className={styles.mealName}
                onClick={() => onEdit(type)}
                aria-label={`Edit ${type.name}`}
              >
                <span className={styles.mealNameText}>{type.name}</span>
                {type.servings !== undefined ? (
                  <span className={styles.mealServings}>
                    serves {type.servings}
                  </span>
                ) : null}
                <PencilSimple size={14} aria-hidden="true" className={styles.mealEditIcon} />
              </button>
              <div className={styles.perDay} aria-label={`${type.name} per day`} role="group">
                <button
                  type="button"
                  aria-label={`Fewer ${type.name} per day`}
                  disabled={perDay <= 1}
                  onClick={() => onPerDayCount(type.id, perDay - 1)}
                >
                  <Minus size={14} aria-hidden="true" />
                </button>
                <span className={styles.perDayValue}>×{Math.max(1, perDay)}</span>
                <button
                  type="button"
                  aria-label={`More ${type.name} per day`}
                  disabled={perDay === 0 || perDay >= MAX_PER_DAY}
                  onClick={() => onPerDayCount(type.id, perDay + 1)}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={styles.dayToggles}>
              {WEEKDAY_ORDER.map((day) => {
                const on = counts[day] > 0;
                const label = DAY_SHORT_LABELS[day];
                return (
                  <button
                    key={day}
                    type="button"
                    className={on ? styles.dayOn : styles.dayOff}
                    aria-pressed={on}
                    aria-label={`${type.name} on ${label}`}
                    onClick={() => onToggleDay(type.id, day)}
                  >
                    <span aria-hidden="true">{label.slice(0, 2)}</span>
                    {counts[day] > 1 && counts[day] !== perDay ? (
                      <span className={styles.dayCount} aria-hidden="true">
                        {counts[day]}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <button type="button" className={styles.addMealType} onClick={onAdd}>
        <Plus size={16} aria-hidden="true" />
        Add a meal type
      </button>
    </>
  );
}
