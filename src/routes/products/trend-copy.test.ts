import { describe, expect, it } from "vitest";
import { trendBadge, trendChangeOnly, trendGlyph, trendSummary } from "./trend-copy.ts";
import type { PriceTrend } from "./price-history-aggregate.ts";
import { makeIsoTimestamp, makePriceObservationId, makeQuantity, makeIngredientId } from "../../domain/index.ts";

const ingredientId = makeIngredientId("rice");

function point(amount: number, price: number, id = "a") {
  return {
    observation: {
      id: makePriceObservationId(id),
      timestamp: makeIsoTimestamp("2026-08-01T10:00:00.000Z"),
      ingredientId,
      quantity: makeQuantity(1000, "g" as const),
      price,
    },
    basis: "per-100g" as const,
    amount,
  };
}

describe("trendGlyph", () => {
  it("maps each direction to its glyph", () => {
    expect(trendGlyph("up")).toBe("▲");
    expect(trendGlyph("down")).toBe("▼");
    expect(trendGlyph("flat")).toBe("–");
  });
});

describe("trendSummary", () => {
  it("reads 'No prices recorded yet' for zero observations", () => {
    const trend: PriceTrend = { kind: "none" };
    expect(trendSummary(trend, "$")).toBe("No prices recorded yet");
  });

  it("reads 'First price recorded' for exactly one observation — no comparison implied", () => {
    const trend: PriceTrend = { kind: "single", latest: point(0.24, 2.4) };
    expect(trendSummary(trend, "$")).toBe("First price recorded — $0.24 per 100 g");
  });

  it("shows an up arrow and percentage for a rising trend", () => {
    const trend: PriceTrend = {
      kind: "trend",
      latest: point(0.3, 3.0, "b"),
      previous: point(0.24, 2.4, "a"),
      deltaPct: 25,
      direction: "up",
    };
    expect(trendSummary(trend, "$")).toBe("▲ up 25.0% since last — $0.30 per 100 g");
  });

  it("reads 'No change' for a flat trend rather than a misleading 0.0%", () => {
    const trend: PriceTrend = {
      kind: "trend",
      latest: point(0.241, 2.41, "b"),
      previous: point(0.24, 2.4, "a"),
      deltaPct: 0.4,
      direction: "flat",
    };
    expect(trendSummary(trend, "$")).toBe("No change since last — $0.24 per 100 g");
  });

  it("uses the caller's currency symbol, never a hardcoded one", () => {
    const trend: PriceTrend = { kind: "single", latest: point(0.24, 2.4) };
    expect(trendSummary(trend, "€")).toBe("First price recorded — €0.24 per 100 g");
  });
});

describe("trendChangeOnly", () => {
  it("reads 'First price recorded' for a single observation, with no price repeated", () => {
    expect(trendChangeOnly({ kind: "single", latest: point(0.24, 2.4) })).toBe("First price recorded");
  });

  it("reads 'No change since last' for a flat trend", () => {
    expect(
      trendChangeOnly({
        kind: "trend",
        latest: point(0.241, 2.41, "b"),
        previous: point(0.24, 2.4, "a"),
        deltaPct: 0.4,
        direction: "flat",
      }),
    ).toBe("No change since last");
  });

  it("shows the direction word and percentage for a real change", () => {
    expect(
      trendChangeOnly({
        kind: "trend",
        latest: point(0.3, 3.0, "b"),
        previous: point(0.24, 2.4, "a"),
        deltaPct: 25,
        direction: "up",
      }),
    ).toBe("▲ up 25.0% since last");
  });
});

describe("trendBadge", () => {
  it("is '—' for none, 'New' for single, and a glyph+percentage for a trend", () => {
    expect(trendBadge({ kind: "none" })).toBe("—");
    expect(trendBadge({ kind: "single", latest: point(0.24, 2.4) })).toBe("New");
    expect(
      trendBadge({
        kind: "trend",
        latest: point(0.3, 3.0, "b"),
        previous: point(0.24, 2.4, "a"),
        deltaPct: 25,
        direction: "up",
      }),
    ).toBe("▲ 25.0%");
    expect(
      trendBadge({
        kind: "trend",
        latest: point(0.24, 2.4, "b"),
        previous: point(0.24, 2.4, "a"),
        deltaPct: 0,
        direction: "flat",
      }),
    ).toBe("No change");
  });
});
