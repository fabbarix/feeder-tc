import { GearSix } from "../ui/icons.ts";
import { EmptyState, ErrorState, Skeleton } from "../ui/components";
import { ThemeControl } from "../ui/theme/ThemeControl";
import { useSettings } from "./settings/useSettings.ts";
import { DaySlotEditor } from "./settings/DaySlotEditor.tsx";
import { Stepper } from "./settings/Stepper.tsx";
import { WEEKDAY_ORDER, layoutFromSlotsByDay, slotsByDay, withSlotAdded, withSlotRemoved } from "./settings/slot-layout.ts";
import type { MealTag, Weekday } from "../domain/index.ts";
import styles from "./settings/settings.module.css";

/**
 * Household settings (WP-22): meal-slot layout per day, household size, and
 * the repeat-exclusion window — all stored in the workbook's `Settings` row
 * and shared by everyone in the household (DESIGN.md §2). Plain-row write
 * via `useSettings`, same pattern as `RecipeEditor.tsx`.
 */
export function Settings() {
  const { loading, error, settings, saving, retry, save } = useSettings();

  function updateHouseholdSize(size: number): void {
    if (!settings) return;
    void save({ ...settings, householdSize: Math.max(1, size) });
  }

  function updateRepeatExclusionWeeks(weeks: number): void {
    if (!settings) return;
    void save({ ...settings, repeatExclusionWeeks: Math.max(0, weeks) });
  }

  function addSlot(day: Weekday, tag: MealTag): void {
    if (!settings) return;
    const byDay = withSlotAdded(slotsByDay(settings.slotLayout), day, tag);
    void save({ ...settings, slotLayout: layoutFromSlotsByDay(byDay) });
  }

  function removeSlot(day: Weekday, index: number): void {
    if (!settings) return;
    const byDay = withSlotRemoved(slotsByDay(settings.slotLayout), day, index);
    void save({ ...settings, slotLayout: layoutFromSlotsByDay(byDay) });
  }

  const byDay = settings ? slotsByDay(settings.slotLayout) : undefined;

  return (
    <section>
      <h1>Settings</h1>

      {loading ? (
        <>
          <Skeleton />
          <Skeleton />
        </>
      ) : null}

      {!loading && error ? <ErrorState title="Couldn't load settings" description={error} onRetry={retry} /> : null}

      {!loading && !error && !settings ? (
        <EmptyState
          icon={GearSix}
          title="Household settings are coming soon"
          description="Household size, meal-slot layout and the repeat window will live here."
        />
      ) : null}

      {!loading && !error && settings && byDay ? (
        <div className={styles.layout}>
          <div className={styles.card}>
            <div className={styles.cardHead}>Meal slots per day</div>
            <div>
              {WEEKDAY_ORDER.map((day) => (
                <DaySlotEditor
                  key={day}
                  day={day}
                  slots={byDay[day]}
                  onAdd={(tag) => addSlot(day, tag)}
                  onRemove={(index) => removeSlot(day, index)}
                />
              ))}
            </div>
          </div>

          <div className={styles.stack}>
            <div className={styles.card}>
              <div className={styles.cardHead}>Household</div>
              <div className={styles.cardBody}>
                <Stepper label="Size" unit="people" min={1} value={settings.householdSize} onChange={updateHouseholdSize} />
                <Stepper
                  label="Don't repeat within"
                  unit="weeks"
                  min={0}
                  value={settings.repeatExclusionWeeks}
                  onChange={updateRepeatExclusionWeeks}
                />
                {saving ? <p className={styles.fieldLabel}>Saving…</p> : null}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardHead}>Appearance · this device only</div>
              <div className={styles.cardBody}>
                <ThemeControl />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
