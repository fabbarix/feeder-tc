/**
 * `Settings` sheet codec (WP-11) — DESIGN.md §3: household size, slot layout
 * per day, repeat-exclusion window N.
 *
 * Two row "kinds" share one sheet (the same union-of-variant-fields style
 * HANDOVER.md's decision register applies to `InventoryEvents`, extended
 * here so `Settings.slotLayout` — an array of arrays — never becomes a
 * packed/JSON cell, honouring invariant 6 (one row = one fact):
 *
 *  - one `"general"` row carries `household_size` / `repeat_exclusion_weeks`;
 *  - one `"slot"` row per (day, position) pair carries `day` / `slot_index` /
 *    `meal_tag` — the most granular fact-per-row split available, so adding
 *    or removing a single slot is a single spreadsheet row edit, not a
 *    comma-list edit inside one cell.
 */
import type { CellRow } from "../../domain/contracts.ts";
import type { DaySlotLayout, MealTag, Settings, Weekday } from "../../domain/types.ts";
import { cellNumber, cellOptionalString, isBlankRow } from "./common.ts";
import { isMealTag, isWeekday } from "./enums.ts";

export const SETTINGS_HEADER: CellRow = [
  "kind",
  "day",
  "slot_index",
  "meal_tag",
  "household_size",
  "repeat_exclusion_weeks",
];

export function encodeSettings(settings: Settings): CellRow[] {
  const rows: CellRow[] = [
    ["general", "", "", "", settings.householdSize, settings.repeatExclusionWeeks],
  ];
  for (const day of settings.slotLayout) {
    day.slots.forEach((tag, index) => {
      rows.push(["slot", day.day, index, tag, "", ""]);
    });
  }
  return rows;
}

/**
 * Aggregates every row into one `Settings` record. `WorkbookStore.settings.
 * read()` has no `DecodeResult` channel (contracts.ts) — Settings is a
 * singleton record, not a list of independent rows — so a missing/malformed
 * "general" row throws (the workbook was never bootstrapped, or was
 * hand-corrupted in a way that leaves no sensible default). An individual
 * malformed "slot" row is dropped silently and the rest of the layout still
 * loads: the same "don't let one bad cell break everything" spirit as the
 * `DecodeResult` sheets, just without anywhere to surface a warning for it
 * given the interface's signature.
 */
export function decodeSettings(rows: readonly CellRow[]): Settings {
  let householdSize: number | undefined;
  let repeatExclusionWeeks: number | undefined;
  const byDay = new Map<Weekday, { index: number; tag: MealTag }[]>();

  for (const row of rows) {
    if (isBlankRow(row)) continue;
    const kind = cellOptionalString(row, 0);
    if (kind === "general") {
      householdSize = cellNumber(row, 4, "household_size");
      repeatExclusionWeeks = cellNumber(row, 5, "repeat_exclusion_weeks");
      continue;
    }
    if (kind === "slot") {
      try {
        const dayRaw = row[1];
        const tagRaw = row[3];
        const day = typeof dayRaw === "string" && isWeekday(dayRaw) ? dayRaw : undefined;
        const tag = typeof tagRaw === "string" && isMealTag(tagRaw) ? tagRaw : undefined;
        if (day === undefined || tag === undefined) {
          throw new Error(`slot row has an invalid day/meal_tag: ${JSON.stringify(row)}`);
        }
        const index = cellNumber(row, 2, "slot_index");
        const list = byDay.get(day) ?? [];
        list.push({ index, tag });
        byDay.set(day, list);
      } catch {
        // Best-effort: one bad slot row shrinks the layout, doesn't break Settings entirely.
      }
    }
  }

  if (householdSize === undefined || repeatExclusionWeeks === undefined) {
    throw new Error('Settings sheet has no valid "general" row — the workbook was not bootstrapped correctly.');
  }

  const slotLayout: DaySlotLayout[] = Array.from(byDay.entries()).map(([day, slots]) => ({
    day,
    slots: slots.sort((a, b) => a.index - b.index).map((s) => s.tag),
  }));

  return { householdSize, slotLayout, repeatExclusionWeeks };
}
