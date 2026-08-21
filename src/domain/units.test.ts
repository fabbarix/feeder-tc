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

// WP-PURCHASING (DESIGN_PURCHASING.md §10.2/§10.3) — cup/tbsp/tsp, the US
// legal set: 1 cup = 240 ml, 1 tbsp = 15 ml, 1 tsp = 5 ml.
describe("convertEntryToCanonical — cup/tbsp/tsp (§10.2)", () => {
  it("converts cup to the canonical ml unit", () => {
    expect(convertEntryToCanonical({ amount: 1, unit: "cup" }, "ml")).toEqual({ amount: 240, unit: "ml" });
  });

  it("converts tbsp to ml", () => {
    expect(convertEntryToCanonical({ amount: 1, unit: "tbsp" }, "ml")).toEqual({ amount: 15, unit: "ml" });
  });

  it("converts tsp to ml", () => {
    expect(convertEntryToCanonical({ amount: 1, unit: "tsp" }, "ml")).toEqual({ amount: 5, unit: "ml" });
  });

  it("is internally consistent: 1 cup = 16 tbsp = 48 tsp", () => {
    const cup = convertEntryToCanonical({ amount: 1, unit: "cup" }, "ml");
    const tbsp16 = convertEntryToCanonical({ amount: 16, unit: "tbsp" }, "ml");
    const tsp48 = convertEntryToCanonical({ amount: 48, unit: "tsp" }, "ml");
    expect(tbsp16.amount).toBeCloseTo(cup.amount, 6);
    expect(tsp48.amount).toBeCloseTo(cup.amount, 6);
  });

  it("without a density, entering a volume unit against a mass-canonical ingredient still throws (never guessed)", () => {
    expect(() => convertEntryToCanonical({ amount: 1, unit: "cup" }, "g")).toThrow(/mass and volume/i);
  });
});

// WP-PURCHASING (§10.1/§10.1a) — the two cross-dimension conversions that DO
// need per-ingredient data, gated behind the optional `density` argument so
// every prior call site (with no third argument) keeps its exact prior
// behaviour.
describe("convertEntryToCanonical — density-based conversions (§10.1)", () => {
  it("converts a cup of flour to grams using gramsPerMl (§10.1a's own example: 1 cup flour = 130 g)", () => {
    const result = convertEntryToCanonical({ amount: 1, unit: "cup" }, "g", { gramsPerMl: 130 / 240 });
    expect(result.unit).toBe("g");
    expect(result.amount).toBeCloseTo(130, 5);
  });

  it("derives tbsp and tsp from the SAME density as cup (§10.1a: one number, every volume unit derives from it)", () => {
    const gramsPerMl = 130 / 240;
    const tbsp = convertEntryToCanonical({ amount: 1, unit: "tbsp" }, "g", { gramsPerMl });
    const tsp = convertEntryToCanonical({ amount: 1, unit: "tsp" }, "g", { gramsPerMl });
    expect(tbsp.amount).toBeCloseTo(8, 0);
    expect(tsp.amount).toBeCloseTo(3, 0);
  });

  it("converts a count entry to grams using gramsPerPiece (2 onions -> grams)", () => {
    const result = convertEntryToCanonical({ amount: 2, unit: "piece" }, "g", { gramsPerPiece: 150 });
    expect(result).toEqual({ amount: 300, unit: "g" });
  });

  it("still throws when density is supplied but the specific field needed is missing", () => {
    // gramsPerPiece present, but this call needs gramsPerMl (volume entry).
    expect(() => convertEntryToCanonical({ amount: 1, unit: "cup" }, "g", { gramsPerPiece: 150 })).toThrow(
      /mass and volume/i,
    );
  });

  it("a supplied density never applies when the dimensions already match (ml entered against an ml-canonical ingredient) — no double conversion", () => {
    const result = convertEntryToCanonical({ amount: 500, unit: "ml" }, "ml", { gramsPerMl: 999 });
    expect(result).toEqual({ amount: 500, unit: "ml" });
  });
});
