/**
 * Human-readable date formatting shared by Home.tsx and RecipeDetail.tsx
 * (WP-VC2 — the approved mock renders dates as "Wednesday 26 August" and
 * "4 August", not a raw `IsoDate` string). Deliberately built on
 * `isoDateWeekday` (`src/domain/planner/slot-layout.ts`) rather than
 * `new Date(iso).toLocaleDateString()`: the latter is timezone- and
 * locale-sensitive (a UTC-parsed IsoDate can print the wrong calendar day
 * west of UTC), where `isoDateWeekday` already solves that once, correctly,
 * for the planner. Parsing the `YYYY-MM-DD` components directly here keeps
 * the day/month numbers immune to the same class of bug.
 */
import { isoDateWeekday } from "../domain/index.ts";
import type { IsoDate } from "../domain/index.ts";

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
] as const;

function dayAndMonth(date: IsoDate): { readonly day: number; readonly month: string } {
  const parts = date.split("-").map(Number) as [number, number, number];
  const [, month, day] = parts;
  return { day, month: MONTH_NAMES[month - 1] ?? "" };
}

/** "Wednesday" — capitalized weekday name for an `IsoDate`. */
export function weekdayLabel(date: IsoDate): string {
  const weekday = isoDateWeekday(date);
  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

/** "Wednesday 26 August" — full weekday + day + month, no year (matches the mock). */
export function formatLongDate(date: IsoDate): string {
  const { day, month } = dayAndMonth(date);
  return `${weekdayLabel(date)} ${day} ${month}`;
}

/** "4 August" — day + month, no weekday, no year (matches the mock's "last on 4 August"). */
export function formatShortDate(date: IsoDate): string {
  const { day, month } = dayAndMonth(date);
  return `${day} ${month}`;
}
