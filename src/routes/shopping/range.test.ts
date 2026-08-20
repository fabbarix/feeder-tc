import { describe, expect, it } from "vitest";
import { makeIsoDate } from "../../domain/index.ts";
import { formatRangeLabel, mondayOnOrBefore, rangeForPreset, weekdayLabel } from "./range.ts";

// 2026-08-20 is a Thursday.
const THURSDAY = makeIsoDate("2026-08-20");
const MONDAY = makeIsoDate("2026-08-17");

describe("mondayOnOrBefore", () => {
  it("rewinds a mid-week date to that week's Monday", () => {
    expect(mondayOnOrBefore(THURSDAY)).toBe(MONDAY);
  });

  it("is idempotent on a Monday itself", () => {
    expect(mondayOnOrBefore(MONDAY)).toBe(MONDAY);
  });
});

describe("weekdayLabel", () => {
  it("short form", () => {
    expect(weekdayLabel(THURSDAY, "short")).toBe("Thu");
    expect(weekdayLabel(MONDAY, "short")).toBe("Mon");
  });

  it("long form", () => {
    expect(weekdayLabel(THURSDAY, "long")).toBe("Thursday");
  });
});

describe("rangeForPreset", () => {
  it("this-week: Monday through Sunday of the current week", () => {
    expect(rangeForPreset("this-week", THURSDAY)).toEqual({
      start: MONDAY,
      end: makeIsoDate("2026-08-23"),
    });
  });

  it("next-week: the following Monday through Sunday", () => {
    expect(rangeForPreset("next-week", THURSDAY)).toEqual({
      start: makeIsoDate("2026-08-24"),
      end: makeIsoDate("2026-08-30"),
    });
  });

  it("2-weeks: this Monday through the Sunday two weeks out", () => {
    expect(rangeForPreset("2-weeks", THURSDAY)).toEqual({
      start: MONDAY,
      end: makeIsoDate("2026-08-30"),
    });
  });

  it("4-weeks: this Monday through the Sunday four weeks out", () => {
    expect(rangeForPreset("4-weeks", THURSDAY)).toEqual({
      start: MONDAY,
      end: makeIsoDate("2026-09-13"),
    });
  });
});

describe("formatRangeLabel", () => {
  it("phrases a single Monday-Sunday week as 'Week of …'", () => {
    expect(formatRangeLabel(rangeForPreset("this-week", THURSDAY))).toBe("Week of 17 August");
  });

  it("phrases a multi-week range as a start – end span", () => {
    expect(formatRangeLabel(rangeForPreset("4-weeks", THURSDAY))).toBe("17 August – 13 September");
  });

  it("phrases a non-Monday-start range as a span too", () => {
    expect(formatRangeLabel({ start: THURSDAY, end: makeIsoDate("2026-08-27") })).toBe("20 August – 27 August");
  });
});
