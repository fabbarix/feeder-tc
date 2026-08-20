/**
 * Entry-time unit conversion (M6-A — DESIGN_PRODUCTS.md §3). This is the one
 * test file allowed to import src/domain/units.ts outside the module itself
 * (see eslint.config.js's no-restricted-imports block, which is what stops
 * every other domain/sheets file from doing the same).
 */
import { describe, expect, it } from "vitest";
import { convertEntryToCanonical } from "./units.ts";

describe("convertEntryToCanonical", () => {
  it("converts kg to the canonical g unit", () => {
    expect(convertEntryToCanonical({ amount: 1, unit: "kg" }, "g")).toEqual({ amount: 1000, unit: "g" });
  });

  it("converts g to g as a pass-through", () => {
    expect(convertEntryToCanonical({ amount: 250, unit: "g" }, "g")).toEqual({ amount: 250, unit: "g" });
  });

  it("converts lb to g (1 lb bag of rice -> 454ish g)", () => {
    const result = convertEntryToCanonical({ amount: 1, unit: "lb" }, "g");
    expect(result.unit).toBe("g");
    expect(result.amount).toBeCloseTo(453.59237, 5);
  });

  it("converts oz to g", () => {
    const result = convertEntryToCanonical({ amount: 16, unit: "oz" }, "g");
    expect(result.amount).toBeCloseTo(453.59237 /* 16 oz == 1 lb */, 4);
  });

  it("converts l to the canonical ml unit", () => {
    expect(convertEntryToCanonical({ amount: 1.5, unit: "l" }, "ml")).toEqual({ amount: 1500, unit: "ml" });
  });

  it("converts ml to ml as a pass-through", () => {
    expect(convertEntryToCanonical({ amount: 330, unit: "ml" }, "ml")).toEqual({ amount: 330, unit: "ml" });
  });

  it("converts fl oz to ml", () => {
    const result = convertEntryToCanonical({ amount: 12, unit: "fl oz" }, "ml");
    expect(result.unit).toBe("ml");
    expect(result.amount).toBeCloseTo(354.882354751, 6);
  });

  it("converts piece to the canonical piece unit as a pass-through", () => {
    expect(convertEntryToCanonical({ amount: 12, unit: "piece" }, "piece")).toEqual({ amount: 12, unit: "piece" });
  });

  it("rejects mass entered against a volume-canonical ingredient", () => {
    expect(() => convertEntryToCanonical({ amount: 500, unit: "g" }, "ml")).toThrow(/mass and volume/i);
  });

  it("rejects volume entered against a mass-canonical ingredient", () => {
    expect(() => convertEntryToCanonical({ amount: 1, unit: "l" }, "g")).toThrow(/mass and volume/i);
  });

  it("rejects mass entered against a count-canonical ingredient", () => {
    expect(() => convertEntryToCanonical({ amount: 1, unit: "kg" }, "piece")).toThrow();
  });

  it("rejects piece entered against a mass-canonical ingredient", () => {
    expect(() => convertEntryToCanonical({ amount: 3, unit: "piece" }, "g")).toThrow();
  });

  it("rejects a canonical unit with no entry-time equivalent (portion)", () => {
    expect(() => convertEntryToCanonical({ amount: 1, unit: "piece" }, "portion")).toThrow(/leftover-lot-only/);
  });

  it("rejects a zero entered amount", () => {
    expect(() => convertEntryToCanonical({ amount: 0, unit: "g" }, "g")).toThrow();
  });

  it("rejects a negative entered amount", () => {
    expect(() => convertEntryToCanonical({ amount: -1, unit: "kg" }, "g")).toThrow();
  });

  it("rejects a non-finite entered amount", () => {
    expect(() => convertEntryToCanonical({ amount: Number.NaN, unit: "g" }, "g")).toThrow();
    expect(() => convertEntryToCanonical({ amount: Number.POSITIVE_INFINITY, unit: "g" }, "g")).toThrow();
  });
});
