import { describe, expect, it } from "vitest";
import { createManualClock } from "../fakes/clock.ts";
import { createFakeRng } from "../fakes/rng.ts";
import { makeIngredientId, makeIsoDate, makeIsoTimestamp, makeQuantity } from "../types.ts";
import { createLeftoverLot } from "./leftovers.ts";

const leftoverChili = makeIngredientId("leftover-chili");

describe("createLeftoverLot", () => {
  it("throws for a non-positive surplus", () => {
    const clock = createManualClock({
      now: makeIsoTimestamp("2026-03-10T18:00:00Z"),
      today: makeIsoDate("2026-03-10"),
    });
    const rng = createFakeRng();
    expect(() =>
      createLeftoverLot(
        {
          ingredientId: leftoverChili,
          surplusQuantity: makeQuantity(0, "portion"),
          location: "fridge",
          cookDate: makeIsoDate("2026-03-10"),
          shelfLifeDays: 4,
        },
        clock,
        rng,
      ),
    ).toThrow(/must be > 0/);

    expect(() =>
      createLeftoverLot(
        {
          ingredientId: leftoverChili,
          surplusQuantity: makeQuantity(-2, "portion"),
          location: "fridge",
          cookDate: makeIsoDate("2026-03-10"),
          shelfLifeDays: 4,
        },
        clock,
        rng,
      ),
    ).toThrow(/must be > 0/);
  });

  it("BDD: cooking surplus creates a leftover lot with the leftover shelf-life default", () => {
    // "Chili" scaled to 8 servings, marked cooked for a household of 4 -> 4 portions surplus.
    const clock = createManualClock({
      now: makeIsoTimestamp("2026-03-10T18:00:00Z"),
      today: makeIsoDate("2026-03-10"),
    });
    const rng = createFakeRng(7);

    const event = createLeftoverLot(
      {
        ingredientId: leftoverChili,
        surplusQuantity: makeQuantity(4, "portion"),
        location: "fridge",
        cookDate: makeIsoDate("2026-03-10"),
        shelfLifeDays: 4,
      },
      clock,
      rng,
    );

    expect(event.type).toBe("purchase");
    expect(event.ingredientId).toBe(leftoverChili);
    expect(event.quantity).toEqual(makeQuantity(4, "portion"));
    expect(event.location).toBe("fridge");
    expect(event.purchaseDate).toBe("2026-03-10");
    expect(event.expiryOverride).toBe("2026-03-14");
    expect(event.timestamp).toBe("2026-03-10T18:00:00Z");
    expect(event.id).toBeTruthy();
    expect(event.lotId).toBeTruthy();
  });

  it("mints a fresh id/lotId per call from the injected Rng (deterministic under a seed)", () => {
    const clock = createManualClock({
      now: makeIsoTimestamp("2026-03-10T18:00:00Z"),
      today: makeIsoDate("2026-03-10"),
    });
    const input = {
      ingredientId: leftoverChili,
      surplusQuantity: makeQuantity(2, "portion"),
      location: "fridge" as const,
      cookDate: makeIsoDate("2026-03-10"),
      shelfLifeDays: 4,
    };

    const a = createLeftoverLot(input, clock, createFakeRng(1));
    const b = createLeftoverLot(input, clock, createFakeRng(1));
    const c = createLeftoverLot(input, clock, createFakeRng(2));

    expect(a.id).toBe(b.id);
    expect(a.lotId).toBe(b.lotId);
    expect(a.id).not.toBe(c.id);
  });
});
