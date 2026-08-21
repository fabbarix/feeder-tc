import { describe, expect, it } from "vitest";
import { createManualClock } from "./fakes/clock.ts";
import { createFakeRng } from "./fakes/rng.ts";
import { makeBarcode, makeIngredientId, makeIsoDate, makeIsoTimestamp, makeQuantity } from "./types.ts";
import { buildPriceObservation } from "./price-observation.ts";

const rice = makeIngredientId("rice");
const barcode = makeBarcode("8001120000123");

const clock = createManualClock({
  now: makeIsoTimestamp("2026-08-21T09:00:00Z"),
  today: makeIsoDate("2026-08-21"),
});

describe("buildPriceObservation", () => {
  it("mints a fresh id/timestamp and omits barcode/source when not supplied", () => {
    const observation = buildPriceObservation(
      { ingredientId: rice, quantity: makeQuantity(500, "g"), price: 2.49 },
      clock,
      createFakeRng(1),
    );
    expect(observation.id).toBeTruthy();
    expect(observation.timestamp).toBe("2026-08-21T09:00:00Z");
    expect(observation.ingredientId).toBe(rice);
    expect(observation.quantity).toEqual(makeQuantity(500, "g"));
    expect(observation.price).toBe(2.49);
    expect("barcode" in observation).toBe(false);
    expect("source" in observation).toBe(false);
  });

  it("carries barcode/source when supplied (a scanned product, a named shop)", () => {
    const observation = buildPriceObservation(
      { ingredientId: rice, quantity: makeQuantity(1000, "g"), price: 4.99, barcode, source: "Trader Joe's" },
      clock,
      createFakeRng(1),
    );
    expect(observation.barcode).toBe(barcode);
    expect(observation.source).toBe("Trader Joe's");
  });

  it("rejects a non-positive price", () => {
    expect(() =>
      buildPriceObservation({ ingredientId: rice, quantity: makeQuantity(500, "g"), price: 0 }, clock, createFakeRng(1)),
    ).toThrow(/positive/);
    expect(() =>
      buildPriceObservation({ ingredientId: rice, quantity: makeQuantity(500, "g"), price: -1 }, clock, createFakeRng(1)),
    ).toThrow(/positive/);
  });

  it("mints the same id for the same seed, different ids for different seeds", () => {
    const input = { ingredientId: rice, quantity: makeQuantity(500, "g"), price: 2.49 };
    const a = buildPriceObservation(input, clock, createFakeRng(5));
    const b = buildPriceObservation(input, clock, createFakeRng(5));
    const c = buildPriceObservation(input, clock, createFakeRng(6));
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });
});
