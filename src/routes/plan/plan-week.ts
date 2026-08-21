/**
 * Pure week-math and formatting helpers for the Plan route (WP-22). Kept
 * local to `src/routes/plan` rather than `src/domain/dates.ts`: this is
 * display formatting and a UI-level "which Monday is the current week"
 * convention, not engine math every WP needs (see `dates.ts`'s own header
 * comment on what belongs there).
 *
 * Weeks start on Monday — matching WP-13's own generator tests
 * (`generator.test.ts`'s `WEEK_START`) and `expandWeekSlots`, which just
 * walks 7 days forward from whatever `weekStart` it's given.
 */
import { addDays, isoDateWeekday, type IsoDate } from "../../domain/index.ts";

const WEEKDAY_OFFSET: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

/** The Monday on or before `date` — the start of `date`'s calendar week. */
export function mondayOnOrBefore(date: IsoDate): IsoDate {
  const offset = WEEKDAY_OFFSET[isoDateWeekday(date)] ?? 0;
  return addDays(date, -offset);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parts(date: IsoDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

/** "Week of 24 August" — the desktop page heading. */
export function formatWeekHeading(weekStart: IsoDate): string {
  const { d, m } = parts(weekStart);
  return `Week of ${d} ${MONTH_NAMES[m - 1]}`;
}

/** "24–30 Aug" — the mobile header's compact range, spanning month names when the week crosses one. */
export function formatWeekRange(weekStart: IsoDate): string {
  const end = addDays(weekStart, 6);
  const start = parts(weekStart);
  const stop = parts(end);
  if (start.m === stop.m) {
    return `${start.d}–${stop.d} ${MONTH_SHORT[start.m - 1]}`;
  }
  return `${start.d} ${MONTH_SHORT[start.m - 1]} – ${stop.d} ${MONTH_SHORT[stop.m - 1]}`;
}

/** "Mon 24" — one day card/column's header label. */
export function formatDayLabel(date: IsoDate): string {
  const { d } = parts(date);
  const weekday = isoDateWeekday(date);
  const index = WEEKDAY_OFFSET[weekday] ?? 0;
  return `${DAY_SHORT[index]} ${d}`;
}

const MEAL_TAG_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export function mealTagLabel(tag: string): string {
  return MEAL_TAG_LABELS[tag] ?? tag;
}

/** The 7 calendar days of the week starting at `weekStart`, in order. */
export function weekDates(weekStart: IsoDate): readonly IsoDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}
