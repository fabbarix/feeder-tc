import { describe, expect, it } from "vitest";
import { systemClock } from "./clock.ts";

describe("systemClock", () => {
  it("today() matches the YYYY-MM-DD prefix of now()", () => {
    const today = systemClock.today();
    const now = systemClock.now();
    expect(now.startsWith(today)).toBe(true);
  });

  it("now() is a parseable ISO-8601 timestamp", () => {
    expect(Number.isNaN(Date.parse(systemClock.now()))).toBe(false);
  });
});
