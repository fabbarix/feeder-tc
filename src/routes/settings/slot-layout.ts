/**
 * Pure helpers for the Settings route's slot-layout editor (WP-22):
 * `Settings.slotLayout` (types.ts) is `readonly DaySlotLayout[]`, which
 * tolerates more than one entry per weekday (WP-13's `expandWeekSlots`
 * flatMaps every entry matching a weekday together — see that module's
 * header comment). The editor works against a simpler one-entry-per-weekday
 * model instead and normalises back to the canonical shape on save, so the
 * UI never has to reason about "which of the two Monday entries did this
 * chip come from".
 *
 * Since custom meal types (2026-10-10) the editor is a grid — one row per
 * meal type, a toggle per weekday, and a per-day count — and every edit
 * rebuilds the days in the household's meal-type order.
 */
import type { DaySlotLayout, MealTag, MealType, Weekday } from "../../domain/index.ts";

export const WEEKDAY_ORDER: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export type SlotsByDay = Readonly<Record<Weekday, readonly MealTag[]>>;

const EMPTY_WEEK: SlotsByDay = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

/** Flattens `Settings.slotLayout` (any number of entries per weekday) into one slot list per weekday. */
export function slotsByDay(layout: readonly DaySlotLayout[]): SlotsByDay {
  const map: Record<Weekday, MealTag[]> = {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
  for (const entry of layout) {
    map[entry.day] = [...map[entry.day], ...entry.slots];
  }
  return map;
}

/** The canonical write-back shape: exactly one `DaySlotLayout` per weekday, in `WEEKDAY_ORDER`. */
export function layoutFromSlotsByDay(byDay: SlotsByDay): readonly DaySlotLayout[] {
  return WEEKDAY_ORDER.map((day) => ({ day, slots: byDay[day] }));
}

/** How many slots of `tag` each day has. */
export type DayCounts = Readonly<Record<Weekday, number>>;

export function dayCounts(byDay: SlotsByDay, tag: MealTag): DayCounts {
  const counts = {} as Record<Weekday, number>;
  for (const day of WEEKDAY_ORDER) counts[day] = byDay[day].filter((slot) => slot === tag).length;
  return counts;
}

/** The row's "per day" count: the most slots of `tag` any one day has (0 when it's on no day). */
export function perDayCount(counts: DayCounts): number {
  return Math.max(0, ...WEEKDAY_ORDER.map((day) => counts[day]));
}

/**
 * Rebuilds every day in the household's meal-type order, from `byDay`'s
 * current counts with `changed`'s counts for one type swapped in. Slots of a
 * type the household no longer lists stay where they were, after the rest —
 * never silently dropped.
 */
function rebuilt(
  byDay: SlotsByDay,
  mealTypes: readonly MealType[],
  changed?: { readonly tag: MealTag; readonly counts: DayCounts },
): SlotsByDay {
  const known = new Set(mealTypes.map((type) => type.id));
  const next = {} as Record<Weekday, MealTag[]>;
  for (const day of WEEKDAY_ORDER) {
    const slots: MealTag[] = [];
    for (const type of mealTypes) {
      const count = changed?.tag === type.id ? changed.counts[day] : dayCounts(byDay, type.id)[day];
      for (let n = 0; n < count; n += 1) slots.push(type.id);
    }
    next[day] = [...slots, ...byDay[day].filter((slot) => !known.has(slot))];
  }
  return next;
}

/** Puts every day back in meal-type order — after the household reorders or adds a type. */
export function inMealTypeOrder(byDay: SlotsByDay, mealTypes: readonly MealType[]): SlotsByDay {
  return rebuilt(byDay, mealTypes);
}

/** Turns `tag` on or off for one day. On means the row's per-day count (at least 1). */
export function withDayToggled(
  byDay: SlotsByDay,
  mealTypes: readonly MealType[],
  tag: MealTag,
  day: Weekday,
): SlotsByDay {
  const counts = dayCounts(byDay, tag);
  const next = { ...counts, [day]: counts[day] > 0 ? 0 : Math.max(1, perDayCount(counts)) };
  return rebuilt(byDay, mealTypes, { tag, counts: next });
}

/** Sets how many slots of `tag` every day it's on has (two snacks a day). */
export function withPerDayCount(
  byDay: SlotsByDay,
  mealTypes: readonly MealType[],
  tag: MealTag,
  count: number,
): SlotsByDay {
  const counts = dayCounts(byDay, tag);
  const next = {} as Record<Weekday, number>;
  for (const day of WEEKDAY_ORDER) next[day] = counts[day] > 0 ? Math.max(1, count) : 0;
  return rebuilt(byDay, mealTypes, { tag, counts: next });
}

/** A newly added meal type starts once a day, every day — the household then trims it. */
export function withMealTypeAdded(byDay: SlotsByDay, mealTypes: readonly MealType[], tag: MealTag): SlotsByDay {
  const counts = {} as Record<Weekday, number>;
  for (const day of WEEKDAY_ORDER) counts[day] = 1;
  return rebuilt(byDay, mealTypes, { tag, counts });
}

/** Takes every slot of `tag` off every day — the meal type is being removed. */
export function withMealTypeRemoved(byDay: SlotsByDay, tag: MealTag): SlotsByDay {
  const next = {} as Record<Weekday, MealTag[]>;
  for (const day of WEEKDAY_ORDER) next[day] = byDay[day].filter((slot) => slot !== tag);
  return next;
}

export { EMPTY_WEEK };
