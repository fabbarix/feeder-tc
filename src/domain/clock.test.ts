import { describe, expect, it } from "vitest";
import { systemClock } from "./clock.ts";
import { daysBetween } from "./dates.ts";
import { makeIsoDate } from "./types.ts";

describe("systemClock", () => {
  // `today()` is deliberately LOCAL (see its own doc comment: "today" means
  // the household's calendar day, not UTC's), while `now()` is a UTC ISO
  // timestamp — those two legitimately disagree on the date for part of
  // every day in any non-zero-offset timezone (e.g. a US Central evening
  // is already "tomorrow" in UTC). Asserting the two share a literal
  // YYYY-MM-DD prefix (the original form of this test) was therefore
  // guaranteed to fail for several hours a day outside UTC — not a flake,
  // a wrong assumption. The real invariant is just that they never
  // disagree by more than one calendar day, which holds for any real
  // UTC offset (max ±14h).
  it("today() is never more than one calendar day from now()'s UTC date", () => {
    const today = systemClock.today();
    const now = systemClock.now();
    const nowDate = makeIsoDate(now.slice(0, 10));
    expect(Math.abs(daysBetween(today, nowDate))).toBeLessThanOrEqual(1);
  });

  it("now() is a parseable ISO-8601 timestamp", () => {
    expect(Number.isNaN(Date.parse(systemClock.now()))).toBe(false);
  });
});
