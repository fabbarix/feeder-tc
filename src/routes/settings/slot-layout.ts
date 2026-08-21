/**
 * Pure helpers for the Settings route's slot-layout editor (WP-22):
 * `Settings.slotLayout` (types.ts) is `readonly DaySlotLayout[]`, which
 * tolerates more than one entry per weekday (WP-13's `expandWeekSlots`
 * flatMaps every entry matching a weekday together — see that module's
 * header comment). The editor works against a simpler one-entry-per-weekday
 * model instead and normalises back to the canonical shape on save, so the
 * UI never has to reason about "which of the two Monday entries did this
 * chip come from".
 */
import type { DaySlotLayout, MealTag, Weekday } from "../../domain/index.ts";

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

export function withSlotAdded(byDay: SlotsByDay, day: Weekday, tag: MealTag): SlotsByDay {
  return { ...byDay, [day]: [...byDay[day], tag] };
}

/** Removes the slot at `index` within `day`'s list (a day may repeat a tag — e.g. two snacks — so removal is positional, not by tag). */
export function withSlotRemoved(byDay: SlotsByDay, day: Weekday, index: number): SlotsByDay {
  return { ...byDay, [day]: byDay[day].filter((_, i) => i !== index) };
}

export { EMPTY_WEEK };
