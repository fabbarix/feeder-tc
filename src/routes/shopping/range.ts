/**
 * Pure date-range helpers for the shopping range picker (WP-23,
 * UI_DESIGN.md §5 "Shopping range": preset chips, not a date picker).
 *
 * Not part of `src/domain` — this is presentation-only date math scoped to
 * one screen (which weekday a preset starts on, how to phrase a range as a
 * label), built on top of `src/domain/dates.ts`'s `IsoDate`/`addDays`
 * primitives rather than duplicating them. `mondayOnOrBefore` uses `Date`
 * internally only as deterministic UTC calendar arithmetic on a fixed
 * input, same discipline as `dates.ts` itself — never `new Date()` with no
 * argument.
 */
import { addDays, type IsoDate } from "../../domain/index.ts";
import type { DateRange } from "../../domain/index.ts";

export type ShoppingRangePreset = "this-week" | "next-week" | "2-weeks" | "4-weeks" | "custom";

export interface RangePresetOption {
  readonly preset: Exclude<ShoppingRangePreset, "custom">;
  readonly label: string;
}

/** UI_DESIGN.md §5 "Shopping range" — presets cover every real case; "Custom…" is the desktop-only escape hatch (see RangeChips.tsx). */
export const RANGE_PRESET_OPTIONS: readonly RangePresetOption[] = [
  { preset: "this-week", label: "This week" },
  { preset: "next-week", label: "Next week" },
  { preset: "2-weeks", label: "2 weeks" },
  { preset: "4-weeks", label: "4 weeks" },
];

const WEEKDAY_SHORT: readonly string[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_LONG: readonly string[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTH_NAMES: readonly string[] = [
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

function weekdayIndex(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  // getUTCDay(): 0 = Sunday .. 6 = Saturday. Rotate to 0 = Monday .. 6 = Sunday.
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Monday of the calendar week containing `date` (weeks start Monday throughout the app — see DESIGN.md's slot layout). */
export function mondayOnOrBefore(date: IsoDate): IsoDate {
  return addDays(date, -weekdayIndex(date));
}

export function weekdayLabel(date: IsoDate, style: "short" | "long" = "short"): string {
  const list = style === "short" ? WEEKDAY_SHORT : WEEKDAY_LONG;
  return list[weekdayIndex(date)] ?? date;
}

/** e.g. "24 August" — matches the mock's desktop range label verbatim. */
export function monthDayLabel(date: IsoDate): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTH_NAMES[m - 1] ?? ""}`.trim();
}

/** The fixed-length ranges a preset chip produces; "custom" has no fixed formula — the caller supplies its own `DateRange` from the calendar escape hatch. */
export function rangeForPreset(preset: Exclude<ShoppingRangePreset, "custom">, today: IsoDate): DateRange {
  const thisMonday = mondayOnOrBefore(today);
  switch (preset) {
    case "this-week":
      return { start: thisMonday, end: addDays(thisMonday, 6) };
    case "next-week": {
      const start = addDays(thisMonday, 7);
      return { start, end: addDays(start, 6) };
    }
    case "2-weeks":
      return { start: thisMonday, end: addDays(thisMonday, 13) };
    case "4-weeks":
      return { start: thisMonday, end: addDays(thisMonday, 27) };
  }
}

/** True if `range` is exactly one Monday-to-Sunday week — the "Week of …" phrasing only reads correctly for that shape. */
function isSingleWeek(range: DateRange): boolean {
  return weekdayIndex(range.start) === 0 && addDays(range.start, 6) === range.end;
}

/** "Week of 24 August" for a single week, "24 August – 20 September" otherwise — matches the mock's desktop subtitle. */
export function formatRangeLabel(range: DateRange): string {
  if (isSingleWeek(range)) {
    return `Week of ${monthDayLabel(range.start)}`;
  }
  return `${monthDayLabel(range.start)} – ${monthDayLabel(range.end)}`;
}
