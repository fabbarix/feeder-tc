import { describe, expect, it } from "vitest";
import { makeIsoDate } from "../../domain/index.ts";
import {
  addMonths,
  formatMonthLabel,
  formatMonthShortLabel,
  isInMonth,
  monthGridDates,
  monthStartOf,
  quarterMonthStarts,
} from "./plan-month.ts";

describe("monthStartOf", () => {
  it("returns the 1st of the given date's month", () => {
    expect(monthStartOf(makeIsoDate("2026-08-26"))).toBe("2026-08-01");
  });
});

describe("addMonths", () => {
  it("adds whole months, staying on the 1st", () => {
    expect(addMonths(makeIsoDate("2026-08-01"), 1)).toBe("2026-09-01");
  });

  it("rolls over the year forward", () => {
    expect(addMonths(makeIsoDate("2026-12-01"), 1)).toBe("2027-01-01");
  });

  it("rolls over the year backward", () => {
    expect(addMonths(makeIsoDate("2026-01-01"), -1)).toBe("2025-12-01");
  });

  it("supports multi-month jumps (quarter math)", () => {
    expect(addMonths(makeIsoDate("2026-08-01"), 2)).toBe("2026-10-01");
  });
});

describe("formatMonthLabel", () => {
  it("formats as 'Month Year'", () => {
    expect(formatMonthLabel(makeIsoDate("2026-08-01"))).toBe("August 2026");
  });
});

describe("formatMonthShortLabel", () => {
  it("formats as 'Month' with no year", () => {
    expect(formatMonthShortLabel(makeIsoDate("2026-08-01"))).toBe("August");
  });
});

describe("isInMonth", () => {
  it("is true for a date within the month", () => {
    expect(isInMonth(makeIsoDate("2026-08-15"), makeIsoDate("2026-08-01"))).toBe(true);
  });

  it("is false for a leading date from the previous month", () => {
    expect(isInMonth(makeIsoDate("2026-07-31"), makeIsoDate("2026-08-01"))).toBe(false);
  });

  it("is false for a trailing date from the next month", () => {
    expect(isInMonth(makeIsoDate("2026-09-01"), makeIsoDate("2026-08-01"))).toBe(false);
  });
});

describe("monthGridDates", () => {
  it("starts on the Monday on/before the 1st and ends on the Sunday on/after the last day", () => {
    // August 2026: the 1st is a Saturday, the 31st is a Monday.
    const dates = monthGridDates(makeIsoDate("2026-08-01"));
    expect(dates[0]).toBe("2026-07-27"); // Monday before Aug 1
    expect(dates[dates.length - 1]).toBe("2026-09-06"); // Sunday after Aug 31
  });

  it("is always a multiple of 7 dates long", () => {
    expect(monthGridDates(makeIsoDate("2026-08-01")).length % 7).toBe(0);
    expect(monthGridDates(makeIsoDate("2026-02-01")).length % 7).toBe(0);
  });

  it("contains every calendar day of the month", () => {
    const dates = monthGridDates(makeIsoDate("2026-08-01"));
    for (let d = 1; d <= 31; d += 1) {
      expect(dates).toContain(makeIsoDate(`2026-08-${String(d).padStart(2, "0")}`));
    }
  });
});

describe("quarterMonthStarts", () => {
  it("returns the given month and the following two, as month-start dates", () => {
    expect(quarterMonthStarts(makeIsoDate("2026-08-01"))).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });

  it("rolls over the year when the quarter spans one", () => {
    expect(quarterMonthStarts(makeIsoDate("2026-12-01"))).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
  });
});
