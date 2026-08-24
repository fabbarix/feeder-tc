import { describe, expect, it } from "vitest";
import { averageAcrossShopsView, byShopView, monthKey, overallView } from "./price-chart-views.ts";
import { normalizedPointsFor } from "./price-history-aggregate.ts";
import {
  makeIngredientId,
  makeIsoTimestamp,
  makePriceObservationId,
  makeQuantity,
  type PriceObservation,
} from "../../domain/index.ts";

const RICE_ID = makeIngredientId("rice");

/** 100 g quantity makes `normalizePrice`'s per-100g amount exactly equal to `price` — keeps the arithmetic in this file's expectations trivial. */
function observation(
  id: string,
  day: string,
  price: number,
  source: string | undefined,
): PriceObservation {
  return {
    id: makePriceObservationId(id),
    timestamp: makeIsoTimestamp(`${day}T10:00:00.000Z`),
    ingredientId: RICE_ID,
    quantity: makeQuantity(100, "g"),
    price,
    ...(source !== undefined ? { source } : {}),
  };
}

describe("monthKey", () => {
  it("takes the YYYY-MM prefix of an ISO timestamp", () => {
    expect(monthKey("2026-08-14T10:00:00.000Z")).toBe("2026-08");
  });
});

describe("overallView vs. averageAcrossShopsView — the pinned divergence", () => {
  // The brief's own example: eight cheap observations at one shop, one dear
  // observation at another, same month. Overall (observation-weighted) must
  // be pulled toward the cheap shop; Average (shop-weighted) must treat
  // both shops equally and land higher, because a household that shops
  // there once still pays that price sometimes.
  const cheapShopObservations = Array.from({ length: 8 }, (_, i) =>
    observation(`cheap-${i}`, "2026-08-10", 10, "Corner Market"),
  );
  const dearObservation = observation("dear-1", "2026-08-11", 50, "Boutique Grocer");
  const points = normalizedPointsFor([...cheapShopObservations, dearObservation]);

  it("Overall pools every observation, pulled toward the shop visited more often", () => {
    const overall = overallView(points);
    expect(overall.buckets).toHaveLength(1);
    // (8*10 + 50) / 9
    expect(overall.buckets[0]!.amount).toBeCloseTo(14.444, 2);
    expect(overall.buckets[0]!.observationCount).toBe(9);
  });

  it("Average across shops weights each shop equally regardless of visit count", () => {
    const average = averageAcrossShopsView(points);
    expect(average.buckets).toHaveLength(1);
    // mean(10, 50)
    expect(average.buckets[0]!.amount).toBeCloseTo(30, 5);
    expect(average.excludedUnlabeledCount).toBe(0);
  });

  it("Overall and Average are genuinely different numbers, in the direction DESIGN_PRODUCTS.md §9 describes", () => {
    const overall = overallView(points);
    const average = averageAcrossShopsView(points);
    expect(average.buckets[0]!.amount).toBeGreaterThan(overall.buckets[0]!.amount);
    // Not just "different" — Average must sit exactly at the shops' own
    // midpoint, not somewhere that happens to differ for an unrelated
    // reason (a careless implementation could pass "not equal" by accident
    // with the wrong formula; this pins the actual value).
    expect(average.buckets[0]!.amount).toBeCloseTo(30, 5);
  });
});

describe("unlabelled observations (no recorded shop) — a permanent bucket, not a migration artefact", () => {
  const points = normalizedPointsFor([
    observation("a", "2026-08-01", 10, "Corner Market"),
    observation("b", "2026-08-02", 20, undefined),
    observation("c", "2026-08-03", 30, undefined),
  ]);

  it("Overall includes them unremarkably — the price was still paid", () => {
    const overall = overallView(points);
    expect(overall.buckets[0]!.observationCount).toBe(3);
    // mean(10, 20, 30)
    expect(overall.buckets[0]!.amount).toBeCloseTo(20, 5);
  });

  it("By shop groups them into their own toggleable series, keyed undefined (never dropped)", () => {
    const series = byShopView(points);
    expect(series).toHaveLength(2);
    const named = series.find((s) => s.shop === "Corner Market");
    const unlabeled = series.find((s) => s.shop === undefined);
    expect(named?.buckets[0]?.amount).toBeCloseTo(10, 5);
    expect(unlabeled?.buckets[0]?.amount).toBeCloseTo(25, 5);
    expect(unlabeled?.buckets[0]?.observationCount).toBe(2);
    // The "not noted" series sorts after every named shop.
    expect(series[series.length - 1]!.shop).toBeUndefined();
  });

  it("Average across shops excludes them and reports how many were excluded", () => {
    const average = averageAcrossShopsView(points);
    expect(average.buckets).toHaveLength(1);
    // Only "Corner Market" contributes — its own single-shop average.
    expect(average.buckets[0]!.amount).toBeCloseTo(10, 5);
    expect(average.excludedUnlabeledCount).toBe(2);
  });
});

describe("empty input", () => {
  it("every view degrades to zero buckets rather than throwing", () => {
    expect(overallView([]).buckets).toHaveLength(0);
    expect(byShopView([]).length).toBe(0);
    const average = averageAcrossShopsView([]);
    expect(average.buckets).toHaveLength(0);
    expect(average.excludedUnlabeledCount).toBe(0);
  });
});
