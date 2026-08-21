import { describe, expect, it } from "vitest";
import { layoutFromSlotsByDay, slotsByDay, withSlotAdded, withSlotRemoved } from "./slot-layout.ts";
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

describe("withSlotAdded / withSlotRemoved", () => {
  it("appends a slot to the named day only", () => {
    const byDay = slotsByDay([{ day: "monday", slots: ["dinner"] }]);
    const next = withSlotAdded(byDay, "monday", "snack");
    expect(next.monday).toEqual(["dinner", "snack"]);
    expect(next.tuesday).toEqual([]);
  });

  it("supports a day repeating the same tag (two snacks)", () => {
    const byDay = slotsByDay([{ day: "monday", slots: ["snack"] }]);
    const next = withSlotAdded(byDay, "monday", "snack");
    expect(next.monday).toEqual(["snack", "snack"]);
  });

  it("removes by positional index, not by tag value", () => {
    const byDay = slotsByDay([{ day: "monday", slots: ["snack", "dinner", "snack"] }]);
    const next = withSlotRemoved(byDay, "monday", 0);
    expect(next.monday).toEqual(["dinner", "snack"]);
  });
});
