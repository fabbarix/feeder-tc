import { describe, expect, it } from "vitest";
import { makeIsoDate } from "./types.ts";
import { addDays, compareIsoDate, isBefore, isOnOrAfter, today } from "./dates.ts";

describe("addDays", () => {
  it("adds days within a month", () => {
    expect(addDays(makeIsoDate("2026-03-01"), 4)).toBe("2026-03-05");
  });

  it("rolls over a month boundary", () => {
    expect(addDays(makeIsoDate("2026-03-30"), 3)).toBe("2026-04-02");
  });

  it("rolls over a year boundary", () => {
    expect(addDays(makeIsoDate("2026-12-30"), 3)).toBe("2027-01-02");
  });

  it("supports negative offsets", () => {
    expect(addDays(makeIsoDate("2026-03-01"), -1)).toBe("2026-02-28");
  });

  it("matches the freezer-suspension scenario: +6 months is at least +180 days out", () => {
    // WP-12 BDD: a lot expiring 2026-03-05, moved to the freezer 2026-03-03,
    // ends up expiring "at least 2026-09-03".
    const frozenExpiry = addDays(makeIsoDate("2026-03-03"), 184); // ~6 months
    expect(isOnOrAfter(frozenExpiry, makeIsoDate("2026-09-03"))).toBe(true);
  });
});

describe("compareIsoDate / isBefore / isOnOrAfter", () => {
  const earlier = makeIsoDate("2026-03-01");
  const later = makeIsoDate("2026-03-05");

  it("compareIsoDate orders correctly", () => {
    expect(compareIsoDate(earlier, later)).toBe(-1);
    expect(compareIsoDate(later, earlier)).toBe(1);
    expect(compareIsoDate(earlier, earlier)).toBe(0);
  });

  it("isBefore", () => {
    expect(isBefore(earlier, later)).toBe(true);
    expect(isBefore(later, earlier)).toBe(false);
  });

  it("isOnOrAfter (the shopping engine's viable-stock test)", () => {
    expect(isOnOrAfter(later, earlier)).toBe(true);
    expect(isOnOrAfter(earlier, earlier)).toBe(true);
    expect(isOnOrAfter(earlier, later)).toBe(false);
  });
});

describe("today", () => {
  it("delegates to the injected clock, never the wall clock directly", () => {
    const fixed = makeIsoDate("2026-03-01");
    expect(today({ today: () => fixed })).toBe(fixed);
  });
});
