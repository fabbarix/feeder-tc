import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CalendarBlank } from "../ui/icons.ts";
import { ConfirmDialog, EmptyState, ErrorState, SegmentedControl, Skeleton, WeekNav } from "../ui/components";
import type { IsoDate, MealTag, PlanSlotId, Settings } from "../domain/index.ts";
import { usePlanWeek } from "./plan/usePlanWeek.ts";
import { PlanSlotRow } from "./plan/PlanSlotRow.tsx";
import { RecipePickerDialog } from "./plan/RecipePickerDialog.tsx";
import { MarkCookedDialog } from "./plan/MarkCookedDialog.tsx";
import { MonthGrid } from "./plan/MonthGrid.tsx";
import { LeftoversAtRiskCard } from "./plan/LeftoversAtRiskCard.tsx";
import { formatDayLabel, formatWeekdayName, mealTagLabel } from "./plan/plan-week.ts";
import { formatMonthShortLabel } from "./plan/plan-month.ts";
import { densityDots, type PlanDay, type PlanSlotView } from "./plan/plan-derive.ts";
import styles from "./plan/plan.module.css";

interface PickerState {
  readonly slotId: PlanSlotId;
  readonly mealTag: MealTag;
  readonly isEmpty: boolean;
}

const VIEW_OPTIONS = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

/** "Remove Chili — Monday dinner?" plus the two-variant body (design/mock-responsive.html § "Removing a plan entry — corrects the record, never erases it silently"). */
function removeConfirmCopy(view: PlanSlotView): { readonly title: string; readonly description: ReactNode } {
  const { slot } = view;
  const entryName =
    slot.filling.kind === "recipe"
      ? (view.recipe?.name ?? "Unknown recipe")
      : slot.filling.kind === "leftover"
        ? (view.leftoverIngredient?.name ?? "Leftover")
        : slot.filling.kind === "leftover-projected"
          ? (view.projectedRecipe ? `Leftover: ${view.projectedRecipe.name}` : "Leftover")
          : "";
  const weekday = formatWeekdayName(slot.date);
  const title = `Remove ${entryName} — ${weekday} ${mealTagLabel(slot.slotType).toLowerCase()}?`;

  // Invariant 1 (HANDOVER.md): a `"cooked"` slot's usage/leftover events are
  // already-recorded `InventoryEvent` rows and stay exactly as they are —
  // removing the slot corrects the plan calendar, not the pantry, so the
  // copy says that in plain language rather than letting a household
  // reasonably (but wrongly) assume it claws back the ingredients too. A
  // slot that was never cooked has nothing recorded to correct, so its
  // copy is one short sentence — "don't ask twice when nothing is at
  // risk" (mock's own note).
  if (slot.state === "cooked") {
    return {
      title,
      description: (
        <>
          <p>{weekday} has already passed.</p>
          <p>
            This only corrects what the plan calendar shows for {weekday}. {entryName}&rsquo;s pantry deduction and
            the leftover it created are already-recorded events and stay exactly as they are — removing the slot
            doesn&rsquo;t undo the cooking.
          </p>
        </>
      ),
    };
  }
  return { title, description: "Nothing's been cooked yet — this just clears the slot." };
}

/**
 * Week/month/quarter planner (WP-22 + the calendar half of WP-VC3/PR#31,
 * dispatched here): configurable slots (Settings owns the layout),
 * "Generate week" (WP-13's `generateWeek`), per-slot reroll/pin/manual
 * pick/scale override/remove, leftover slots, the mark-cooked confirm/
 * tweak screen, and the month/quarter density overview. Every mutation
 * goes through `usePlanWeek`, which never lets this component touch
 * `WorkbookStore`/the outbox directly (same container pattern as
 * `Pantry.tsx`/`usePantryInventory.ts`).
 *
 * Week and month are two ROUTES (`/plan`, `/plan/month` — App.tsx), not
 * just local state: design/mock-responsive.html's own desktop tier shows
 * the month view at `feeder.torchetti.us/plan/month`, and a real URL means
 * the browser back button and a bookmark both do the right thing. Both
 * paths render this same component; `useLocation` picks the view.
 */
export function Plan() {
  const plan = usePlanWeek();
  const { settings } = plan;
  const navigate = useNavigate();
  const location = useLocation();
  const view: "week" | "month" = location.pathname.endsWith("/month") ? "month" : "week";

  const [picker, setPicker] = useState<PickerState | undefined>(undefined);
  const [removeSlotId, setRemoveSlotId] = useState<PlanSlotId | undefined>(undefined);

  /**
   * One day's card — shared markup between the desktop seven-column `.week`
   * grid, the tablet four-column banded `.week4` grid, and the mobile
   * `.dayList` stacked cards (design/mock-responsive.html's Plan tier note:
   * all three are the SAME `.day`/`PlanSlotRow` unit, just regrouped into a
   * different container per tier — never a forked day-card implementation).
   */
  function renderDay(day: PlanDay, settingsForDay: Settings): ReactNode {
    return (
      <div className={`${styles.day}${day.date === plan.today ? ` ${styles.dayToday}` : ""}`} key={day.date}>
        <h2 className={styles.dayHeading}>{formatDayLabel(day.date)}</h2>
        {day.slots.map((slotView) => (
          <PlanSlotRow
            key={slotView.slot.id}
            view={slotView}
            settings={settingsForDay}
            isBusy={plan.busySlotIds.has(slotView.slot.id)}
            onReroll={(id) => void plan.reroll(id)}
            onTogglePin={(id) => void plan.togglePin(id)}
            onCook={plan.startMarkCooked}
            onOpenPicker={openPicker}
            onScaleChange={(id, servings) => void plan.setScaleServings(id, servings)}
            onRemove={setRemoveSlotId}
          />
        ))}
      </div>
    );
  }

  function openPicker(slotId: PlanSlotId): void {
    for (const day of plan.days) {
      const found = day.slots.find((v) => v.slot.id === slotId);
      if (found) {
        setPicker({ slotId, mealTag: found.slot.slotType, isEmpty: found.slot.filling.kind === "empty" });
        return;
      }
    }
  }

  function findWeekView(slotId: PlanSlotId): PlanSlotView | undefined {
    for (const day of plan.days) {
      const found = day.slots.find((v) => v.slot.id === slotId);
      if (found) return found;
    }
    return undefined;
  }

  function goToWeekOfDay(date: IsoDate): void {
    plan.goToWeekOf(date);
    navigate("/plan");
  }

  const hasAnySlots = plan.days.some((day) => day.slots.length > 0);
  const removeView = removeSlotId ? findWeekView(removeSlotId) : undefined;

  return (
    <section>
      <div className={styles.header}>
        {/* WP-VC5 defect sweep: same treatment as Pantry.tsx/Shopping.tsx/
            Settings.tsx — the nav item already names this page. */}
        <h1 className="visually-hidden">Plan</h1>
        <div className={styles.headerActions}>
          <SegmentedControl
            aria-label="Plan view"
            options={VIEW_OPTIONS}
            value={view}
            onChange={(next) => navigate(next === "month" ? "/plan/month" : "/plan")}
          />
          {view === "week" ? (
            <button type="button" className={styles.generateButton} onClick={() => void plan.generateWeek()} disabled={plan.generating || plan.loading}>
              {plan.generating ? "Generating…" : "Generate week"}
            </button>
          ) : null}
        </div>
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
          {view === "week" ? (
            <div className={styles.navRow}>
              <WeekNav label={plan.weekRange} onPrevious={plan.goToPreviousWeek} onNext={plan.goToNextWeek} onToday={plan.goToToday} />
            </div>
          ) : (
            <div className={styles.navRow}>
              <WeekNav
                label={plan.monthLabel}
                onPrevious={plan.goToPreviousMonth}
                onNext={plan.goToNextMonth}
                previousLabel="Previous month"
                nextLabel="Next month"
                onToday={plan.goToToday}
              />
            </div>
          )}

          {view === "week" && hasAnySlots ? (
            <p className={styles.subtitle}>
              {`Household of ${settings.householdSize} · ${plan.summary.staplesPlaced} staple${plan.summary.staplesPlaced === 1 ? "" : "s"} placed · ${plan.summary.emptySlots} slot${plan.summary.emptySlots === 1 ? "" : "s"} empty`}
              {plan.summary.excluded
                ? ` · ${plan.summary.excluded.name} excluded (cooked ${plan.summary.excluded.weeksAgo} week${plan.summary.excluded.weeksAgo === 1 ? "" : "s"} ago)`
                : ""}
            </p>
          ) : null}

          {!hasAnySlots ? (
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
          ) : view === "week" ? (
            <>
              {/* Desktop (>=1440px): seven columns, the whole week visible
                  (UI_DESIGN.md §13). */}
              <div className={styles.week}>{plan.days.map((day) => renderDay(day, settings))}</div>

              {/* Tablet (768–1439px): four columns, banded Mon–Thu / Fri–Sun
                  (design/mock-responsive.html's Plan tier note — seven
                  columns is a desktop luxury, not a tablet one: at ~135px/
                  column a normal recipe name wraps three lines and reroll/
                  pin/Remove stack vertically under Cook for lack of width).
                  Both bands use the IDENTICAL 4-track grid, so Fri/Sat/Sun
                  are the same width as Mon–Thu, not stretched to fill a
                  short last row — the weekend band's own 4th cell (below,
                  LeftoversAtRiskCard) is what keeps the 4-track grid honest
                  for a 3-day band. Rejected:
                  a scrollable strip (hides most of the week, losing the
                  "whole week visible" property that justifies a wide tier
                  at all) and `auto-fill`/`minmax` (orphans a lone 7th card
                  on its own row). */}
              <div className={styles.weekBands}>
                <div className={styles.weekBand}>
                  {/* A plain label, not a heading (matches the mock's own
                      `<div class="weekband-label">`) — the day cards inside
                      already carry the real `<h2>` headings; a second
                      heading level here would just be group chrome, not
                      document structure. */}
                  <div className={styles.weekBandLabel}>Mon – Thu</div>
                  <div className={styles.week4}>{plan.days.slice(0, 4).map((day) => renderDay(day, settings))}</div>
                </div>
                <div className={styles.weekBand}>
                  <div className={styles.weekBandLabel}>Fri – Sun</div>
                  <div className={styles.week4}>
                    {plan.days.slice(4, 7).map((day) => renderDay(day, settings))}
                    {/* Keeps the weekend band's 3 days on the same 4-track
                        grid as Mon–Thu instead of stretching Sunday to fill
                        a 4th column — see this block's own top-level comment.
                        Used to be a bare `aria-hidden` filler div (matching
                        the mock exactly); round-2 tablet review read that as
                        a missing column, and the owner chose to put
                        leftovers-at-risk here instead (LeftoversAtRiskCard's
                        own doc comment has the full reasoning). */}
                    <LeftoversAtRiskCard items={plan.leftoversAtRisk} today={plan.today} />
                  </div>
                </div>
              </div>

              {/* Mobile (<768px): day cards, thumb-navigable. */}
              <div className={styles.dayList}>
                {plan.days.map((day) => (
                  <div className={`${styles.dayCard}${day.date === plan.today ? ` ${styles.dayCardToday}` : ""}`} key={day.date}>
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
                    {day.slots.map((slotView) => (
                      <PlanSlotRow
                        key={slotView.slot.id}
                        view={slotView}
                        settings={settings}
                        isBusy={plan.busySlotIds.has(slotView.slot.id)}
                        onReroll={(id) => void plan.reroll(id)}
                        onTogglePin={(id) => void plan.togglePin(id)}
                        onCook={plan.startMarkCooked}
                        onOpenPicker={openPicker}
                        onScaleChange={(id, servings) => void plan.setScaleServings(id, servings)}
                        onRemove={setRemoveSlotId}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <MonthGrid
                dates={plan.monthDays.map((d) => d.date)}
                monthStart={plan.monthStart}
                today={plan.today}
                dotsByDate={new Map(plan.monthDays.map((d) => [d.date, densityDots(d)] as const))}
                onSelectDay={goToWeekOfDay}
              />
              <div className={styles.quarterSection}>
                <h2 className={styles.quarterHeading}>Quarter</h2>
                <div className={styles.quarterGrid}>
                  {plan.quarterMonths.map((qm) => (
                    <div key={qm.monthStart}>
                      <div className={styles.qmonthLabel}>{formatMonthShortLabel(qm.monthStart)}</div>
                      <MonthGrid
                        dense
                        dates={qm.days.map((d) => d.date)}
                        monthStart={qm.monthStart}
                        today={plan.today}
                        dotsByDate={new Map(qm.days.map((d) => [d.date, densityDots(d)] as const))}
                        onSelectDay={goToWeekOfDay}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
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
        open={removeView !== undefined}
        title={removeView ? removeConfirmCopy(removeView).title : ""}
        description={removeView ? removeConfirmCopy(removeView).description : undefined}
        confirmLabel="Remove from plan"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          if (removeSlotId) void plan.removeSlot(removeSlotId);
          setRemoveSlotId(undefined);
        }}
        onCancel={() => setRemoveSlotId(undefined)}
      />

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
