/**
 * Slot-layout expansion — WP-13.
 *
 * `Settings.slotLayout` describes a *day of the week* (DESIGN.md §2
 * "Planning": "per-day slot layout ... configurable in Settings"). Turning
 * that into the concrete slots for one calendar week means walking seven
 * calendar days from a week-start date and, for each one, looking up its
 * weekday's configured slots. `PlanSlot.slotIndex` (contracts.ts) then gives
 * each of those slots a stable position, since a day may repeat a tag (two
 * snack slots) and `slotType` alone can't disambiguate them.
 *
 * Deliberately does not import `dates.ts`'s weekday-free helpers — this
 * module needs one more primitive (IsoDate -> Weekday) that no other WP
 * needs, so it stays local rather than widening a shared, multi-package
 * helper module for a single caller. It reuses the same deterministic
 * UTC-`Date` technique `dates.ts` uses (fixed input in, fixed output out —
 * never `new Date()`/`Date.now()` with no argument).
 */
import { addDays } from "../dates.ts";
import type { IsoDate, MealTag, Settings, Weekday } from "../types.ts";

const WEEKDAYS_BY_UTC_DAY: readonly Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Pure IsoDate -> Weekday. Deterministic: same input always yields the same output. */
export function isoDateWeekday(date: IsoDate): Weekday {
  const parts = date.split("-").map(Number) as [number, number, number];
  const [y, m, d] = parts;
  const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const weekday = WEEKDAYS_BY_UTC_DAY[utcDay];
  if (weekday === undefined) {
    throw new Error(`isoDateWeekday: unreachable UTC day index ${utcDay}`);
  }
  return weekday;
}

/** One concrete slot position within a generated week, before it has a filling. */
export interface WeekSlotSpec {
  readonly date: IsoDate;
  readonly slotType: MealTag;
  /** 0-based position within this date's configured slots — mirrors `PlanSlot.slotIndex`. */
  readonly slotIndex: number;
}

/**
 * Expands `Settings.slotLayout` into the seven days starting at `weekStart`
 * (whichever weekday `weekStart` happens to fall on — callers choose their
 * own week-start convention, this function just walks 7 days forward).
 *
 * A weekday with no matching `DaySlotLayout` entry contributes no slots that
 * day (a valid configuration — e.g. no breakfast slot logged on weekends).
 * If more than one `DaySlotLayout` names the same weekday, their `slots`
 * arrays are concatenated in the order they appear in `settings.slotLayout`.
 */
export function expandWeekSlots(
  settings: Settings,
  weekStart: IsoDate,
): readonly WeekSlotSpec[] {
  const specs: WeekSlotSpec[] = [];
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const date = addDays(weekStart, dayOffset);
    const weekday = isoDateWeekday(date);
    const daySlots = settings.slotLayout
      .filter((layout) => layout.day === weekday)
      .flatMap((layout) => layout.slots);
    daySlots.forEach((slotType, slotIndex) => {
      specs.push({ date, slotType, slotIndex });
    });
  }
  return specs;
}
