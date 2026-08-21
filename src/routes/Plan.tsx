import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarBlank } from "../ui/icons.ts";
import { ConfirmDialog, EmptyState, ErrorState, Skeleton, WeekNav } from "../ui/components";
import type { MealTag, PlanSlotId } from "../domain/index.ts";
import { usePlanWeek } from "./plan/usePlanWeek.ts";
import { PlanSlotRow } from "./plan/PlanSlotRow.tsx";
import { RecipePickerDialog } from "./plan/RecipePickerDialog.tsx";
import { MarkCookedDialog } from "./plan/MarkCookedDialog.tsx";
import { formatDayLabel, mealTagLabel } from "./plan/plan-week.ts";
import styles from "./plan/plan.module.css";

interface PickerState {
  readonly slotId: PlanSlotId;
  readonly mealTag: MealTag;
  readonly isEmpty: boolean;
}

/**
 * Week planner (WP-22): configurable slots (Settings owns the layout),
 * "Generate week" (WP-13's `generateWeek`), per-slot reroll/pin/manual
 * pick/scale override, leftover slots, and the mark-cooked confirm/tweak
 * screen. Every mutation goes through `usePlanWeek`, which never lets this
 * component touch `WorkbookStore`/the outbox directly (same container
 * pattern as `Pantry.tsx`/`usePantryInventory.ts`).
 */
export function Plan() {
  const plan = usePlanWeek();
  const { settings } = plan;
  const [picker, setPicker] = useState<PickerState | undefined>(undefined);

  function openPicker(slotId: PlanSlotId): void {
    for (const day of plan.days) {
      const view = day.slots.find((v) => v.slot.id === slotId);
      if (view) {
        setPicker({ slotId, mealTag: view.slot.slotType, isEmpty: view.slot.filling.kind === "empty" });
        return;
      }
    }
  }

  const hasAnySlots = plan.days.some((day) => day.slots.length > 0);

  return (
    <section>
      <div className={styles.header}>
        <h1>Plan</h1>
        <button type="button" className={styles.generateButton} onClick={() => void plan.generateWeek()} disabled={plan.generating || plan.loading}>
          {plan.generating ? "Generating…" : "Generate week"}
        </button>
      </div>

      {plan.loading ? (
        <>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </>
      ) : null}

      {!plan.loading && plan.error ? (
        <ErrorState title="Couldn't load your plan" description={plan.error} onRetry={plan.retry} />
      ) : null}

      {!plan.loading && !plan.error && settings ? (
        <>
          <div className={styles.navRow}>
            <WeekNav label={plan.weekRange} onPrevious={plan.goToPreviousWeek} onNext={plan.goToNextWeek} />
          </div>

          {hasAnySlots ? (
            <p className={styles.subtitle}>
              {`Household of ${settings.householdSize} · ${plan.summary.staplesPlaced} staple${plan.summary.staplesPlaced === 1 ? "" : "s"} placed · ${plan.summary.emptySlots} slot${plan.summary.emptySlots === 1 ? "" : "s"} empty`}
              {plan.summary.excluded
                ? ` · ${plan.summary.excluded.name} excluded (cooked ${plan.summary.excluded.weeksAgo} week${plan.summary.excluded.weeksAgo === 1 ? "" : "s"} ago)`
                : ""}
            </p>
          ) : null}

          {hasAnySlots ? (
            <>
              {/* Desktop: seven columns, the whole week visible (UI_DESIGN.md §13). */}
              <div className={styles.week}>
                {plan.days.map((day) => (
                  <div className={styles.day} key={day.date}>
                    <h2 className={styles.dayHeading}>{formatDayLabel(day.date)}</h2>
                    {day.slots.map((view) => (
                      <PlanSlotRow
                        key={view.slot.id}
                        view={view}
                        settings={settings}
                        isBusy={plan.busySlotIds.has(view.slot.id)}
                        onReroll={(id) => void plan.reroll(id)}
                        onTogglePin={(id) => void plan.togglePin(id)}
                        onCook={plan.startMarkCooked}
                        onOpenPicker={openPicker}
                        onScaleChange={(id, servings) => void plan.setScaleServings(id, servings)}
                      />
                    ))}
                  </div>
                ))}
              </div>

              {/* Mobile: day cards, thumb-navigable. */}
              <div className={styles.dayList}>
                {plan.days.map((day) => (
                  <div className={styles.dayCard} key={day.date}>
                    {/* `h2` is a direct child of `.dayCard` (same nesting
                        depth as the desktop grid's `.day > h2`), not wrapped
                        in its own head-bar div — the slot-count text lives
                        INSIDE the heading instead of a sibling wrapper, so
                        "the day's container" is reachable the same way
                        (one level up from the heading) regardless of which
                        layout is visible at the current viewport. */}
                    <h2 className={styles.dayCardHeading}>
                      {formatDayLabel(day.date)}{" "}
                      <span className={styles.dayCardMeta}>
                        {day.slots.length === 0 ? "empty" : `${day.slots.length} slot${day.slots.length === 1 ? "" : "s"}`}
                      </span>
                    </h2>
                    {day.slots.map((view) => (
                      <PlanSlotRow
                        key={view.slot.id}
                        view={view}
                        settings={settings}
                        isBusy={plan.busySlotIds.has(view.slot.id)}
                        onReroll={(id) => void plan.reroll(id)}
                        onTogglePin={(id) => void plan.togglePin(id)}
                        onCook={plan.startMarkCooked}
                        onOpenPicker={openPicker}
                        onScaleChange={(id, servings) => void plan.setScaleServings(id, servings)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={CalendarBlank}
              title="No meal slots configured"
              description="Add a slot layout in Settings — how many meals per day — before generating a week."
              action={
                <Link to="/settings" className={styles.generateButton}>
                  Go to Settings
                </Link>
              }
            />
          )}
        </>
      ) : null}

      {picker ? (
        <RecipePickerDialog
          open
          title={`Pick a meal for ${mealTagLabel(picker.mealTag)}`}
          recipes={plan.pickableRecipes(picker.mealTag)}
          onPick={(recipeId) => void plan.pickRecipe(picker.slotId, recipeId)}
          onClose={() => setPicker(undefined)}
          {...(!picker.isEmpty ? { clearLabel: "Clear this slot", onClear: () => void plan.clearSlot(picker.slotId) } : {})}
        />
      ) : null}

      {plan.markCookedDraft ? (
        <MarkCookedDialog
          draft={plan.markCookedDraft}
          onConfirm={(input) => void plan.confirmMarkCooked(input)}
          onCancel={plan.cancelMarkCooked}
        />
      ) : null}

      <ConfirmDialog
        open={plan.staleWeekConflict}
        title="This week changed elsewhere"
        description="Someone else changed this week's plan since you opened it. Generating now overwrites those changes with a freshly generated week."
        confirmLabel="Generate anyway"
        cancelLabel="Keep this week"
        destructive
        onConfirm={() => {
          plan.cancelStaleWeekConflict();
          void plan.generateWeek(true);
        }}
        onCancel={plan.cancelStaleWeekConflict}
      />
    </section>
  );
}
