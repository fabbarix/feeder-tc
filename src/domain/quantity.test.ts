import { describe, expect, it } from "vitest";
import { makeQuantity } from "./types.ts";
import { assertSameUnit, formatQuantity, isZero, sameUnit } from "./quantity.ts";

describe("sameUnit", () => {
  it("is true for matching units", () => {
    expect(sameUnit(makeQuantity(1, "g"), makeQuantity(2, "g"))).toBe(true);
  });

  it("is false for mismatched units", () => {
    expect(sameUnit(makeQuantity(1, "g"), makeQuantity(2, "ml"))).toBe(false);
  });
});

describe("assertSameUnit", () => {
  it("does not throw for matching units", () => {
    expect(() => assertSameUnit(makeQuantity(1, "g"), makeQuantity(2, "g"))).not.toThrow();
  });

  it("throws for mismatched units (invariant 3: reject mixed-unit combination)", () => {
    expect(() => assertSameUnit(makeQuantity(1, "g"), makeQuantity(2, "ml"))).toThrow(/Mixed units/);
  });

  it("includes the optional context in the error message", () => {
    expect(() => assertSameUnit(makeQuantity(1, "g"), makeQuantity(2, "ml"), "FIFO fold")).toThrow(
      /FIFO fold/,
    );
  });
});

describe("isZero", () => {
  it("is true for a zero amount", () => {
    expect(isZero(makeQuantity(0, "piece"))).toBe(true);
  });

  it("is false for a non-zero amount", () => {
    expect(isZero(makeQuantity(0.5, "piece"))).toBe(false);
  });
});

describe("formatQuantity", () => {
  it("renders amount and unit for display", () => {
    expect(formatQuantity(makeQuantity(400, "g"))).toBe("400 g");
  });
});
