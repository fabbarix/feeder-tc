import { describe, expect, it } from "vitest";
import { makeIsoDate } from "../../domain/index.ts";
import {
  formatDayLabel,
  formatWeekHeading,
  formatWeekRange,
  mealTagLabel,
  mondayOnOrBefore,
  weekDates,
} from "./plan-week.ts";

describe("mondayOnOrBefore", () => {
  it("returns the same date when it is already a Monday", () => {
    expect(mondayOnOrBefore(makeIsoDate("2026-08-17"))).toBe("2026-08-17");
  });

  it("walks back to the Monday for a mid-week date", () => {
    expect(mondayOnOrBefore(makeIsoDate("2026-08-20"))).toBe("2026-08-17");
  });

  it("walks back across the week for a Sunday", () => {
    expect(mondayOnOrBefore(makeIsoDate("2026-08-23"))).toBe("2026-08-17");
  });
});

describe("formatWeekHeading", () => {
  it("formats as 'Week of D Month'", () => {
    expect(formatWeekHeading(makeIsoDate("2026-08-24"))).toBe("Week of 24 August");
  });
});

describe("formatWeekRange", () => {
  it("formats a week within one month as 'D–D Mon'", () => {
    expect(formatWeekRange(makeIsoDate("2026-08-24"))).toBe("24–30 Aug");
  });

  it("formats a week spanning two months with both month names", () => {
    expect(formatWeekRange(makeIsoDate("2026-08-31"))).toBe("31 Aug – 6 Sep");
  });
});

describe("formatDayLabel", () => {
  it("formats as 'Ddd D'", () => {
    expect(formatDayLabel(makeIsoDate("2026-08-24"))).toBe("Mon 24");
    expect(formatDayLabel(makeIsoDate("2026-08-30"))).toBe("Sun 30");
  });
});

describe("mealTagLabel", () => {
  it("title-cases known meal tags", () => {
    expect(mealTagLabel("breakfast")).toBe("Breakfast");
    expect(mealTagLabel("dinner")).toBe("Dinner");
  });
});

describe("weekDates", () => {
  it("returns 7 consecutive dates starting at weekStart", () => {
    expect(weekDates(makeIsoDate("2026-08-24"))).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
  });
});
