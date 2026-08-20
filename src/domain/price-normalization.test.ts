import { describe, expect, it } from "vitest";
import { normalizePrice } from "./price-normalization.ts";
import {
  makeIngredientId,
  makeIsoTimestamp,
  makePriceObservationId,
  makeQuantity,
  type PriceObservation,
} from "./types.ts";

const RICE = makeIngredientId("rice");
const TS = makeIsoTimestamp("2026-08-20T12:00:00Z");

function observation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    id: makePriceObservationId("obs-1"),
    timestamp: TS,
    ingredientId: RICE,
    quantity: makeQuantity(500, "g"),
    price: 2.5,
    ...overrides,
  };
}

describe("normalizePrice", () => {
  it("normalizes a mass observation to price per 100g", () => {
    // 500 g for $2.50 -> $0.50 / 100g
    expect(normalizePrice(observation())).toEqual({ basis: "per-100g", amount: 0.5 });
  });

  it("normalizes a 1kg pack to the same per-100g basis as a 500g pack for a fluctuation check", () => {
    const small = normalizePrice(observation({ quantity: makeQuantity(500, "g"), price: 2.5 }));
    const large = normalizePrice(observation({ quantity: makeQuantity(1000, "g"), price: 4.5 }));
    expect(small.basis).toBe(large.basis);
    expect(small.amount).toBeCloseTo(0.5, 10);
    expect(large.amount).toBeCloseTo(0.45, 10);
    expect(large.amount).toBeLessThan(small.amount); // the 1kg pack is the better deal
  });

  it("normalizes a volume observation to price per 100ml", () => {
    expect(normalizePrice(observation({ quantity: makeQuantity(1000, "ml"), price: 3 }))).toEqual({
      basis: "per-100ml",
      amount: 0.3,
    });
  });

  it("normalizes a count observation to price per piece", () => {
    expect(normalizePrice(observation({ quantity: makeQuantity(12, "piece"), price: 3.6 }))).toEqual({
      basis: "per-piece",
      amount: 0.3,
    });
  });

  it("rejects a portion-unit observation", () => {
    expect(() => normalizePrice(observation({ quantity: makeQuantity(1, "portion") }))).toThrow(/portion/);
  });

  it("rejects a zero quantity", () => {
    expect(() => normalizePrice(observation({ quantity: makeQuantity(0, "g") }))).toThrow();
  });

  it("rejects a negative quantity", () => {
    expect(() => normalizePrice(observation({ quantity: makeQuantity(-5, "g") }))).toThrow();
  });

  it("rejects a negative price", () => {
    expect(() => normalizePrice(observation({ price: -1 }))).toThrow();
  });

  it("is deterministic and pure — same input, same output, no hidden state", () => {
    const obs = observation();
    expect(normalizePrice(obs)).toEqual(normalizePrice(obs));
  });
});
