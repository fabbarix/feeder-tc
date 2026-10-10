import { describe, expect, it } from "vitest";
import {
  dayCounts,
  inMealTypeOrder,
  layoutFromSlotsByDay,
  perDayCount,
  slotsByDay,
  withDayToggled,
  withMealTypeRemoved,
  withPerDayCount,
} from "./slot-layout.ts";
import type { DaySlotLayout } from "../../domain/index.ts";

describe("slotsByDay", () => {
  it("maps one entry per weekday straight through", () => {
    const layout: readonly DaySlotLayout[] = [
      { day: "monday", slots: ["breakfast", "dinner"] },
      { day: "tuesday", slots: ["dinner"] },
    ];
    const byDay = slotsByDay(layout);
    expect(byDay.monday).toEqual(["breakfast", "dinner"]);
    expect(byDay.tuesday).toEqual(["dinner"]);
    expect(byDay.wednesday).toEqual([]);
  });

  it("concatenates multiple entries for the same weekday, in order", () => {
    const layout: readonly DaySlotLayout[] = [
      { day: "monday", slots: ["breakfast"] },
      { day: "monday", slots: ["dinner"] },
    ];
    expect(slotsByDay(layout).monday).toEqual(["breakfast", "dinner"]);
  });
});

describe("layoutFromSlotsByDay", () => {
  it("emits exactly 7 entries, one per weekday, in week order", () => {
    const byDay = slotsByDay([{ day: "friday", slots: ["dinner"] }]);
    const layout = layoutFromSlotsByDay(byDay);
    expect(layout.map((e) => e.day)).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
    expect(layout.find((e) => e.day === "friday")?.slots).toEqual(["dinner"]);
    expect(layout.find((e) => e.day === "monday")?.slots).toEqual([]);
  });

  it("round-trips a normal layout through slotsByDay then back", () => {
    const original: readonly DaySlotLayout[] = [
      { day: "monday", slots: ["breakfast", "lunch", "dinner"] },
      { day: "tuesday", slots: ["dinner"] },
      { day: "wednesday", slots: [] },
      { day: "thursday", slots: ["dinner"] },
      { day: "friday", slots: ["dinner"] },
      { day: "saturday", slots: ["breakfast", "lunch", "dinner"] },
      { day: "sunday", slots: ["breakfast", "dinner"] },
    ];
    expect(layoutFromSlotsByDay(slotsByDay(original))).toEqual(original);
  });
});

describe("meal-type grid edits", () => {
  const types = [
    { id: "breakfast", name: "Breakfast" },
    { id: "dinner", name: "Dinner" },
    { id: "snack", name: "Snack" },
  ];

  it("turns a meal on for a day in meal-type order, not after dinner", () => {
    const byDay = slotsByDay([{ day: "monday", slots: ["dinner"] }]);
    expect(withDayToggled(byDay, types, "breakfast", "monday").monday).toEqual(["breakfast", "dinner"]);
  });

  it("turns a meal off for a day, every copy of it", () => {
    const byDay = slotsByDay([{ day: "monday", slots: ["snack", "dinner", "snack"] }]);
    expect(withDayToggled(byDay, types, "snack", "monday").monday).toEqual(["dinner"]);
  });

  it("turns a meal on at the row's per-day count", () => {
    const byDay = slotsByDay([
      { day: "monday", slots: ["snack", "snack"] },
      { day: "tuesday", slots: [] },
    ]);
    expect(withDayToggled(byDay, types, "snack", "tuesday").tuesday).toEqual(["snack", "snack"]);
  });

  it("sets the per-day count on every day the meal is on, and leaves other days alone", () => {
    const byDay = slotsByDay([
      { day: "monday", slots: ["dinner", "snack"] },
      { day: "tuesday", slots: ["dinner"] },
    ]);
    const next = withPerDayCount(byDay, types, "snack", 2);
    expect(next.monday).toEqual(["dinner", "snack", "snack"]);
    expect(next.tuesday).toEqual(["dinner"]);
    expect(perDayCount(dayCounts(next, "snack"))).toBe(2);
  });

  it("keeps another meal's uneven days as they are", () => {
    const byDay = slotsByDay([
      { day: "monday", slots: ["snack", "snack"] },
      { day: "tuesday", slots: ["snack"] },
    ]);
    const next = withDayToggled(byDay, types, "dinner", "monday");
    expect(next.monday).toEqual(["dinner", "snack", "snack"]);
    expect(next.tuesday).toEqual(["snack"]);
  });

  it("keeps slots of a type the household no longer lists, after the rest", () => {
    const byDay = slotsByDay([{ day: "monday", slots: ["old-type", "dinner"] }]);
    expect(inMealTypeOrder(byDay, types).monday).toEqual(["dinner", "old-type"]);
  });

  it("removes a meal type from every day", () => {
    const byDay = slotsByDay([
      { day: "monday", slots: ["breakfast", "dinner"] },
      { day: "friday", slots: ["breakfast"] },
    ]);
    const next = withMealTypeRemoved(byDay, "breakfast");
    expect(next.monday).toEqual(["dinner"]);
    expect(next.friday).toEqual([]);
  });
});
