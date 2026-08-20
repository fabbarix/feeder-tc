import { describe, expect, it } from "vitest";
import { makeIsoDate, makeIsoTimestamp } from "../types.ts";
import { createFixedClock, createManualClock } from "./clock.ts";

describe("createFixedClock", () => {
  it("always returns the same now() and today()", () => {
    const clock = createFixedClock(makeIsoTimestamp("2026-03-01T09:00:00Z"), makeIsoDate("2026-03-01"));
    expect(clock.now()).toBe("2026-03-01T09:00:00Z");
    expect(clock.today()).toBe("2026-03-01");
    expect(clock.now()).toBe(clock.now());
  });
});

describe("createManualClock", () => {
  it("advances only when set() is called", () => {
    const clock = createManualClock({
      now: makeIsoTimestamp("2026-03-01T09:00:00Z"),
      today: makeIsoDate("2026-03-01"),
    });
    expect(clock.today()).toBe("2026-03-01");
    clock.set({ today: makeIsoDate("2026-03-02") });
    expect(clock.today()).toBe("2026-03-02");
    // now() is untouched by a today()-only set().
    expect(clock.now()).toBe("2026-03-01T09:00:00Z");
  });
});
