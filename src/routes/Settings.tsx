import { useState } from "react";
import { GearSix } from "../ui/icons.ts";
import { EmptyState, ErrorState, Skeleton } from "../ui/components";
import { ThemeControl } from "../ui/theme/ThemeControl";
import { useSettings } from "./settings/useSettings.ts";
import { MAX_PER_DAY, MealsEditor } from "./settings/MealsEditor.tsx";
import { MealTypeDialog, type MealTypeUsage } from "./settings/MealTypeDialog.tsx";
import { SettingsGroup } from "./settings/SettingsGroup.tsx";
import { RecipeImportSettings } from "./settings/RecipeImportSettings.tsx";
import { Stepper } from "./Stepper.tsx";
import {
  inMealTypeOrder,
  layoutFromSlotsByDay,
  slotsByDay,
  withDayToggled,
  withMealTypeAdded,
  withMealTypeRemoved,
  withPerDayCount,
  type SlotsByDay,
} from "./settings/slot-layout.ts";
import {
  mealTypesOf,
  newMealTypeId,
  type MealTag,
  type MealType,
  type Settings as SettingsRow,
  type Weekday,
} from "../domain/index.ts";
import { useWorkbookContext } from "../workbook-context.ts";
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
import { DEFAULT_REUSE_GAP_SLOTS } from "../domain/planner/leftover-projection.ts";
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
const NO_SETTINGS_ROW_ERROR = "This meal planner doesn't have any settings saved yet.";

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
  const { store, clock } = useWorkbookContext();
  // Which meal type the add/edit dialog is open for — `id: undefined` adds a new one.
  const [dialog, setDialog] = useState<{ readonly id: MealTag | undefined } | undefined>(undefined);
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
    void save((current) => ({
      ...(current ?? settings),
      repeatExclusionWeeks: Math.max(0, weeks),
    }));
  }

  /**
   * WP-leftover-planning: how many other meals must come between a meal and
   * any slot the generator fills from its leftovers (`Settings.reuseGapSlots`
   * — types.ts's own doc comment has the full reasoning). Same
   * refresh-before-edit save pattern as every other field on this screen.
   */
  function updateReuseGapSlots(gap: number): void {
    if (!settings) return;
    void save((current) => ({ ...(current ?? settings), reuseGapSlots: Math.max(0, gap) }));
  }

  /**
   * Every meal-layout edit (custom meal types, 2026-10-10) rebuilds the
   * layout and/or the meal-type list from `current`, same refresh-before-
   * edit pattern as the fields above.
   */
  function editMeals(edit: (base: SettingsRow, byDay: SlotsByDay, types: readonly MealType[]) => SettingsRow): void {
    if (!settings) return;
    void save((current) => {
      const base = current ?? settings;
      return edit(base, slotsByDay(base.slotLayout), mealTypesOf(base));
    });
  }

  function toggleDay(tag: MealTag, day: Weekday): void {
    editMeals((base, byDay, types) => ({
      ...base,
      slotLayout: layoutFromSlotsByDay(withDayToggled(byDay, types, tag, day)),
    }));
  }

  function setPerDay(tag: MealTag, count: number): void {
    editMeals((base, byDay, types) => ({
      ...base,
      slotLayout: layoutFromSlotsByDay(withPerDayCount(byDay, types, tag, Math.min(MAX_PER_DAY, count))),
    }));
  }

  function saveMealType(id: MealTag | undefined, fields: { readonly name: string; readonly servings: number | undefined }): void {
    editMeals((base, byDay, types) => {
      if (id === undefined) {
        const type = withServings({ id: newMealTypeId(fields.name, types), name: fields.name }, fields.servings);
        const nextTypes = [...types, type];
        return {
          ...base,
          mealTypes: nextTypes,
          slotLayout: layoutFromSlotsByDay(withMealTypeAdded(byDay, nextTypes, type.id)),
        };
      }
      return {
        ...base,
        mealTypes: types.map((type) => (type.id === id ? withServings({ id, name: fields.name }, fields.servings) : type)),
      };
    });
    setDialog(undefined);
  }

  function moveMealType(id: MealTag, direction: -1 | 1): void {
    editMeals((base, byDay, types) => {
      const from = types.findIndex((type) => type.id === id);
      const to = from + direction;
      if (from === -1 || to < 0 || to >= types.length) return base;
      const nextTypes = [...types];
      [nextTypes[from], nextTypes[to]] = [nextTypes[to]!, nextTypes[from]!];
      return { ...base, mealTypes: nextTypes, slotLayout: layoutFromSlotsByDay(inMealTypeOrder(byDay, nextTypes)) };
    });
  }

  function removeMealType(id: MealTag): void {
    editMeals((base, byDay, types) => ({
      ...base,
      mealTypes: types.filter((type) => type.id !== id),
      slotLayout: layoutFromSlotsByDay(withMealTypeRemoved(byDay, id)),
    }));
    setDialog(undefined);
  }

  /** What still uses a meal type: recipes tagged with it, and upcoming meals planned for it. */
  async function mealTypeUsage(id: MealTag): Promise<MealTypeUsage> {
    const [recipes, planSlots] = await Promise.all([store.recipes.readAll(), store.planSlots.readAll()]);
    const today = clock.today();
    return {
      recipes: recipes.rows.filter((recipe) => recipe.mealTags.includes(id)).length,
      upcomingMeals: planSlots.rows.filter(
        (slot) =>
          slot.slotType === id && slot.state === "planned" && slot.filling.kind !== "empty" && slot.date >= today,
      ).length,
    };
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
  const dialogIndex = settings && dialog?.id !== undefined ? mealTypesOf(settings).findIndex((t) => t.id === dialog.id) : -1;
  const dialogType = settings && dialogIndex >= 0 ? mealTypesOf(settings)[dialogIndex] : undefined;

  return (
    <section>
      {/* WP-VC5 defect sweep: same treatment as Pantry.tsx/Shopping.tsx/
          Plan.tsx — the nav item already names this page. */}
      <h1 className="visually-hidden">Settings</h1>

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
          <div className={styles.stack}>
            <SettingsGroup
              title="Household"
              note="Shared with everyone using this meal planner."
              aside={saving ? <span className={styles.saving}>Saving…</span> : null}
            >
              <div className={styles.row}>
                <Stepper
                  layout="row"
                  label="Household size"
                  hint="Recipes are scaled to this"
                  unit="people"
                  unitOne="person"
                  min={1}
                  value={settings.householdSize}
                  onChange={updateHouseholdSize}
                />
              </div>
              <div className={styles.row}>
                <Stepper
                  layout="row"
                  label="Don't repeat within"
                  hint="Before a recipe comes round again"
                  unit="weeks"
                  unitOne="week"
                  min={0}
                  value={settings.repeatExclusionWeeks}
                  onChange={updateRepeatExclusionWeeks}
                />
              </div>
              <div className={styles.row}>
                <Stepper
                  layout="row"
                  label="Wait before reusing leftovers"
                  hint="Other meals in between"
                  unit="meals"
                  unitOne="meal"
                  min={0}
                  value={settings.reuseGapSlots ?? DEFAULT_REUSE_GAP_SLOTS}
                  onChange={updateReuseGapSlots}
                />
              </div>
            </SettingsGroup>

            <SettingsGroup title="Meals" note="Which meals Plan fills in, how many a day, and on which days.">
              <MealsEditor
                settings={settings}
                byDay={byDay}
                onToggleDay={toggleDay}
                onPerDayCount={setPerDay}
                onEdit={(type) => setDialog({ id: type.id })}
                onAdd={() => setDialog({ id: undefined })}
              />
            </SettingsGroup>
          </div>

          <div className={styles.stack}>
            <SettingsGroup title="This device">
              <ThemeControl />
            </SettingsGroup>

            <RecipeImportSettings />
          </div>
        </div>
      ) : null}

      {settings && dialog ? (
        <MealTypeDialog
          key={dialog.id ?? "new"}
          editing={dialogType}
          householdSize={settings.householdSize}
          {...(dialogType
            ? {
                position: { index: dialogIndex, count: mealTypesOf(settings).length },
                onMove: (direction: -1 | 1) => moveMealType(dialogType.id, direction),
                usage: () => mealTypeUsage(dialogType.id),
                onRemove: () => removeMealType(dialogType.id),
              }
            : {})}
          onSave={(fields) => saveMealType(dialog.id, fields)}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
    </section>
  );
}

function withServings(type: MealType, servings: number | undefined): MealType {
  return servings === undefined ? { id: type.id, name: type.name } : { id: type.id, name: type.name, servings };
}
