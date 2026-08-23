import { GearSix } from "../ui/icons.ts";
import { EmptyState, ErrorState, Skeleton } from "../ui/components";
import { ThemeControl } from "../ui/theme/ThemeControl";
import { useSettings } from "./settings/useSettings.ts";
import { DaySlotEditor } from "./settings/DaySlotEditor.tsx";
import { Stepper } from "./Stepper.tsx";
import {
  WEEKDAY_ORDER,
  layoutFromSlotsByDay,
  slotsByDay,
  withSlotAdded,
  withSlotRemoved,
} from "./settings/slot-layout.ts";
import type { MealTag, Weekday } from "../domain/index.ts";
// Deliberately `bootstrap.ts` directly, not the `sheets/index.ts` barrel:
// this lazy route (App.tsx) importing the SAME barrel App.tsx already
// imports eagerly made Rollup fold several otherwise route-lazy chunks
// (the barcode WASM decoder, purchasing, several icon chunks...) into the
// EAGER entry — measured 8 modulepreloaded chunks before, 16 after, a
// dependency this file has no actual use for. Reaching straight into the
// one sibling module that owns the one constant this route needs avoids
// coupling to the sheets layer's entire surface (auth, transport, picker,
// registry, migrate) and keeps this chunk boundary exactly what it was.
import { DEFAULT_SETTINGS } from "../sheets/bootstrap.ts";
import styles from "./settings/settings.module.css";
import forms from "./forms.module.css";

/**
 * `decodeSettings` (sheets/codecs/settings.ts) throws this EXACT string when
 * the `Settings` sheet has no "general" row — a workbook old enough to
 * predate this feature, or one PR #36's schema self-heal only just gave the
 * tab and its header back to, without a data row (there is no single
 * sensible default to backfill silently). Matched here, rather than
 * reworking the codec to return `undefined` instead of throwing, to keep
 * this a copy/recovery-UI fix (WP-31 scope) rather than a data-layer
 * behaviour change: everywhere else that calls `store.settings.read()`
 * still gets today's "throw on a missing row" contract unchanged.
 */
const NO_SETTINGS_ROW_ERROR =
  'Settings sheet has no valid "general" row — the workbook was not bootstrapped correctly.';

/**
 * Household settings (WP-22): meal-slot layout per day, household size, and
 * the repeat-exclusion window — all stored in the workbook's `Settings` row
 * and shared by everyone in the household (DESIGN.md §2). Plain-row write
 * via `useSettings` — WP-stale-save: refresh-before-edit merge rather than
 * `RecipeEditor.tsx`'s re-read-and-confirm, see that hook's own doc comment
 * for why (every write here is one rapid tap, not a discrete form Save).
 */
export function Settings() {
  const { loading, error, settings, saving, retry, save } = useSettings();
  const missingSettingsRow = error === NO_SETTINGS_ROW_ERROR;

  // Each of these builds its next `Settings` from `current` — the freshest
  // row `save` re-reads (see useSettings.ts's own doc comment) — not from
  // this render's `settings` closure, so a concurrent household member's
  // change to a DIFFERENT field (e.g. someone else adding a meal slot while
  // this device bumps household size) survives instead of being reset by
  // this tap. The outer `settings` is only ever a type-safe fallback: `save`
  // only calls `edit` with `undefined` when `settings` is itself
  // `undefined`, and every call site here is already guarded on `settings`
  // being defined.
  function updateHouseholdSize(size: number): void {
    if (!settings) return;
    void save((current) => ({ ...(current ?? settings), householdSize: Math.max(1, size) }));
  }

  function updateRepeatExclusionWeeks(weeks: number): void {
    if (!settings) return;
    void save((current) => ({ ...(current ?? settings), repeatExclusionWeeks: Math.max(0, weeks) }));
  }

  function addSlot(day: Weekday, tag: MealTag): void {
    if (!settings) return;
    void save((current) => {
      const base = current ?? settings;
      const byDay = withSlotAdded(slotsByDay(base.slotLayout), day, tag);
      return { ...base, slotLayout: layoutFromSlotsByDay(byDay) };
    });
  }

  function removeSlot(day: Weekday, index: number): void {
    if (!settings) return;
    void save((current) => {
      const base = current ?? settings;
      const byDay = withSlotRemoved(slotsByDay(base.slotLayout), day, index);
      return { ...base, slotLayout: layoutFromSlotsByDay(byDay) };
    });
  }

  /**
   * Writes `DEFAULT_SETTINGS` — the same defaults `bootstrapWorkbook` gives
   * every NEW workbook (`sheets/bootstrap.ts`) — from a button the user
   * presses, so a workbook missing its `Settings` row becomes a one-click
   * fix instead of a dead-end error naming a problem with no stated
   * remedy. The household can edit every value immediately afterwards.
   */
  function setUpDefaults(): void {
    void save(() => DEFAULT_SETTINGS);
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

      {!loading && error && !missingSettingsRow ? (
        <ErrorState title="Couldn't load settings" description={error} onRetry={retry} />
      ) : null}

      {!loading && (missingSettingsRow || (!error && !settings)) ? (
        <EmptyState
          icon={GearSix}
          title="No settings saved yet"
          description="That's normal for a meal planner created before this feature existed — set up sensible defaults (2 people, breakfast/lunch/dinner every day) and adjust them right after."
          action={
            <button type="button" className={forms.addButton} onClick={setUpDefaults}>
              Set up defaults
            </button>
          }
        />
      ) : null}

      {!loading && settings && byDay ? (
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
                <Stepper
                  label="Size"
                  unit="people"
                  unitOne="person"
                  min={1}
                  value={settings.householdSize}
                  onChange={updateHouseholdSize}
                />
                <Stepper
                  label="Don't repeat within"
                  unit="weeks"
                  unitOne="week"
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
