/**
 * Pure date-math helpers for IsoDate (design requirement 5).
 *
 * The inventory, planner, and shopping engines (WP-12/13/14) all need date
 * arithmetic — expiry = purchase date + shelf-life days, "is this lot viable
 * by the cook date", "was this recipe cooked within the last N weeks". This
 * module is the one place that math lives, so no engine reinvents it.
 *
 * `addDays` uses `Date` internally only as deterministic UTC calendar
 * arithmetic on a fixed input — never `new Date()`/`Date.now()` with no
 * argument, which would read the wall clock and break purity. Given the same
 * IsoDate and offset, `addDays` always returns the same IsoDate.
 */
import { makeIsoDate, type IsoDate } from "./types.ts";

function toUtcParts(date: IsoDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

function toIsoDateString(utcMillis: number): IsoDate {
  const d = new Date(utcMillis);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return makeIsoDate(`${y}-${m}-${day}`);
}

/** Adds `days` calendar days to `date` (negative to go backwards). Pure, deterministic. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const { y, m, d } = toUtcParts(date);
  const millis = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  return toIsoDateString(millis);
}

/** -1 if `a` is before `b`, 0 if equal, 1 if `a` is after `b`. */
export function compareIsoDate(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return compareIsoDate(a, b) < 0;
}

/** True if `a` is on or after `b` — the shopping engine's viable-stock test ("expiry ≥ cook date"). */
export function isOnOrAfter(a: IsoDate, b: IsoDate): boolean {
  return compareIsoDate(a, b) >= 0;
}

/** Today's calendar day, from the injected Clock — never `new Date()` directly. */
export function today(clock: { today(): IsoDate }): IsoDate {
  return clock.today();
}
