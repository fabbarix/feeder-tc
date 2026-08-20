import { describe, expect, it } from "vitest";
import { makeIsoDate } from "../types.ts";
import type { Settings } from "../types.ts";
import { expandWeekSlots, isoDateWeekday } from "./slot-layout.ts";

describe("isoDateWeekday", () => {
  it("maps known dates to their weekday", () => {
    // 2026-08-17 is a Monday.
    expect(isoDateWeekday(makeIsoDate("2026-08-17"))).toBe("monday");
    expect(isoDateWeekday(makeIsoDate("2026-08-18"))).toBe("tuesday");
    expect(isoDateWeekday(makeIsoDate("2026-08-23"))).toBe("sunday");
  });

  it("is deterministic for the same input", () => {
    const date = makeIsoDate("2026-01-01");
    expect(isoDateWeekday(date)).toBe(isoDateWeekday(date));
  });
});

describe("expandWeekSlots", () => {
  const settings: Settings = {
    householdSize: 4,
    repeatExclusionWeeks: 3,
    slotLayout: [
      { day: "monday", slots: ["breakfast", "dinner"] },
      { day: "tuesday", slots: ["dinner"] },
      { day: "wednesday", slots: ["dinner"] },
      { day: "thursday", slots: ["dinner"] },
      { day: "friday", slots: ["dinner"] },
      { day: "saturday", slots: ["dinner", "snack", "snack"] },
      { day: "sunday", slots: ["dinner"] },
    ],
  };

  it("walks 7 days from weekStart and expands each day's configured slots", () => {
    const specs = expandWeekSlots(settings, makeIsoDate("2026-08-17")); // a Monday
    expect(specs).toHaveLength(10); // mon 2 + tue/wed/thu/fri 1 each (4) + sat 3 + sun 1
    expect(specs[0]).toEqual({ date: makeIsoDate("2026-08-17"), slotType: "breakfast", slotIndex: 0 });
    expect(specs[1]).toEqual({ date: makeIsoDate("2026-08-17"), slotType: "dinner", slotIndex: 1 });
  });

  it("assigns slotIndex per day so repeated tags on one day are disambiguated and ordered", () => {
    const specs = expandWeekSlots(settings, makeIsoDate("2026-08-17"));
    const saturday = specs.filter((s) => s.date === makeIsoDate("2026-08-22"));
    expect(saturday.map((s) => [s.slotType, s.slotIndex])).toEqual([
      ["dinner", 0],
      ["snack", 1],
      ["snack", 2],
    ]);
  });

  it("a weekday with no configured layout contributes no slots", () => {
    const sparse: Settings = {
      householdSize: 2,
      repeatExclusionWeeks: 0,
      slotLayout: [{ day: "wednesday", slots: ["dinner"] }],
    };
    const specs = expandWeekSlots(sparse, makeIsoDate("2026-08-17"));
    expect(specs).toHaveLength(1);
    expect(specs[0]?.date).toBe(makeIsoDate("2026-08-19"));
  });

  it("works starting from a non-Monday weekStart", () => {
    const specs = expandWeekSlots(settings, makeIsoDate("2026-08-19")); // Wednesday
    expect(specs).toHaveLength(10);
    expect(specs[0]?.date).toBe(makeIsoDate("2026-08-19"));
    expect(specs[specs.length - 1]?.date).toBe(makeIsoDate("2026-08-25"));
  });
});
