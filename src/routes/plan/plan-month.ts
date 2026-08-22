/**
 * Pure month/quarter calendar-math for the Plan route's density views
 * (design/mock-responsive.html §"Month — an overview, not an editor"):
 * "one cell per day, filled/empty/leftover as dots ... the exact same
 * `.monthgrid` component at a smaller cell size and with day numbers
 * dropped, three months side by side. Design one component, not two —
 * quarter is month at lower density, nothing else changes."
 *
 * Kept alongside `plan-week.ts` rather than in it: `plan-week.ts` is
 * Monday-start WEEK math (`mondayOnOrBefore`, `weekDates`); this is
 * calendar-MONTH math (first-of-month, month grids, quarter triplets) — a
 * distinct enough concern, and month/quarter is net-new surface, to earn
 * its own file rather than widening that one indefinitely.
 */
import { addDays, type IsoDate } from "../../domain/index.ts";
import { mondayOnOrBefore, sundayOnOrAfter } from "./plan-week.ts";

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

function parts(date: IsoDate): { readonly y: number; readonly m: number; readonly d: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function makeDate(y: number, m: number, d: number): IsoDate {
  return `${y.toString().padStart(4, "0")}-${pad(m)}-${pad(d)}` as IsoDate;
}

/** Number of calendar days in month `m` (1-12) of year `y` — `Date.UTC`'s own day-0-of-next-month trick, the same deterministic-UTC technique `dates.ts` uses throughout. */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The 1st of `date`'s calendar month. */
export function monthStartOf(date: IsoDate): IsoDate {
  const { y, m } = parts(date);
  return makeDate(y, m, 1);
}

/** `monthStart` shifted by `delta` whole calendar months (may be negative). Always returns a 1st-of-month date, matching `monthStartOf`'s contract — callers never need to re-normalise. */
export function addMonths(monthStart: IsoDate, delta: number): IsoDate {
  const { y, m } = parts(monthStart);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return makeDate(ny, nm, 1);
}

/** "August 2026" — the month view's heading. */
export function formatMonthLabel(monthStart: IsoDate): string {
  const { y, m } = parts(monthStart);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "August" — the quarter strip's per-month label (no year — the three months are always contiguous and the header carries the range). */
export function formatMonthShortLabel(monthStart: IsoDate): string {
  const { m } = parts(monthStart);
  return MONTH_NAMES[m - 1] ?? "";
}

/** True when `date` falls within `date`'s own calendar month as named by `monthStart` — distinguishes the grid's leading/trailing days (previous/next month, shown muted) from the month itself. */
export function isInMonth(date: IsoDate, monthStart: IsoDate): boolean {
  const a = parts(date);
  const b = parts(monthStart);
  return a.y === b.y && a.m === b.m;
}

/**
 * Every date shown in `monthStart`'s calendar grid: the Monday on/before the
 * 1st through the Sunday on/after the last day of the month — always a
 * multiple of 7 (5 or 6 full weeks), so the grid is a clean
 * `repeat(7, 1fr)` with no ragged final row. Leading/trailing dates
 * belonging to the adjacent month are still included (the mock renders them
 * `mute`, not omitted) — `isInMonth` is how a caller tells them apart.
 */
export function monthGridDates(monthStart: IsoDate): readonly IsoDate[] {
  const { y, m } = parts(monthStart);
  const lastOfMonth = makeDate(y, m, daysInMonth(y, m));
  const gridStart = mondayOnOrBefore(monthStart);
  const gridEnd = sundayOnOrAfter(lastOfMonth);

  const dates: IsoDate[] = [];
  let cur = gridStart;
  // `gridEnd` is always reached in a bounded number of steps (at most 6
  // weeks — 42 days); a `while (cur <= gridEnd)` string comparison is safe
  // here because ISO dates sort lexicographically.
  while (cur <= gridEnd) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

/** The 7 weekday-initial column headers, Monday-first, matching `monthGridDates`'s column order. */
export const MONTH_GRID_DOW: readonly string[] = ["M", "T", "W", "T", "F", "S", "S"];

/** The 3 consecutive month-start dates making up the quarter beginning at `monthStart` — "the exact same `.monthgrid` component ... three months side by side" (mock). */
export function quarterMonthStarts(monthStart: IsoDate): readonly [IsoDate, IsoDate, IsoDate] {
  return [monthStart, addMonths(monthStart, 1), addMonths(monthStart, 2)];
}
