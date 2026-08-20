import { describe, expect, it } from "vitest";
import { makeIngredientId, makeIsoDate, makeLotId, makeQuantity, type Lot } from "../types.ts";
import { compareLotsForFifo, planFifoConsumption } from "./fifo.ts";

const rice = makeIngredientId("rice");
const flour = makeIngredientId("flour");

function lot(id: string, purchaseDate: string, amount: number, unit: "g" | "ml" | "piece" = "g"): Lot {
  return {
    id: makeLotId(id),
    ingredientId: rice,
    quantity: makeQuantity(amount, unit),
    purchaseDate: makeIsoDate(purchaseDate),
    location: "pantry",
    expiry: makeIsoDate("2027-01-01"),
    expiryOverridden: false,
  };
}

describe("compareLotsForFifo", () => {
  it("orders by purchaseDate when they differ", () => {
    const older = lot("older", "2026-01-01", 100);
    const newer = lot("newer", "2026-01-10", 100);
    expect(compareLotsForFifo(older, newer)).toBe(-1);
    expect(compareLotsForFifo(newer, older)).toBe(1);
  });

  it("breaks a purchaseDate tie with a.id < b.id", () => {
    const a = lot("a-lot", "2026-01-01", 100);
    const b = lot("b-lot", "2026-01-01", 100);
    expect(compareLotsForFifo(a, b)).toBe(-1);
  });

  it("breaks a purchaseDate tie with a.id > b.id", () => {
    const a = lot("a-lot", "2026-01-01", 100);
    const b = lot("b-lot", "2026-01-01", 100);
    expect(compareLotsForFifo(b, a)).toBe(1);
  });

  it("is 0 for the same lot compared to itself (equal date, equal id)", () => {
    const only = lot("same", "2026-01-01", 100);
    expect(compareLotsForFifo(only, only)).toBe(0);
  });
});

describe("planFifoConsumption", () => {
  it("throws for a negative requested quantity", () => {
    expect(() => planFifoConsumption([], rice, makeQuantity(-1, "g"))).toThrow(
      /must be >= 0/,
    );
  });

  it("returns no allocations and zero shortfall for a zero-amount request against existing stock", () => {
    const plan = planFifoConsumption([lot("a", "2026-01-01", 500)], rice, makeQuantity(0, "g"));
    expect(plan).toEqual({ allocations: [], shortfall: 0 });
  });

  it("returns full shortfall when no lots exist for the ingredient at all", () => {
    const plan = planFifoConsumption([], rice, makeQuantity(300, "g"));
    expect(plan).toEqual({ allocations: [], shortfall: 300 });
  });

  it("ignores lots of a different ingredient", () => {
    const flourLot: Lot = { ...lot("f", "2026-01-01", 500), ingredientId: flour };
    const plan = planFifoConsumption([flourLot], rice, makeQuantity(100, "g"));
    expect(plan).toEqual({ allocations: [], shortfall: 100 });
  });

  it("ignores lots already fully consumed (zero remaining)", () => {
    const empty = lot("e", "2026-01-01", 0);
    const stocked = lot("s", "2026-01-05", 200);
    const plan = planFifoConsumption([empty, stocked], rice, makeQuantity(50, "g"));
    expect(plan).toEqual({ allocations: [{ lotId: makeLotId("s"), amount: 50 }], shortfall: 0 });
  });

  it("consumes a single lot exactly, leaving zero shortfall and no further allocations", () => {
    const plan = planFifoConsumption([lot("a", "2026-01-01", 300)], rice, makeQuantity(300, "g"));
    expect(plan).toEqual({ allocations: [{ lotId: makeLotId("a"), amount: 300 }], shortfall: 0 });
  });

  it("partially consumes the oldest lot only, when it covers the full request", () => {
    const oldest = lot("old", "2026-01-01", 1000);
    const newer = lot("new", "2026-01-10", 500);
    const plan = planFifoConsumption([newer, oldest], rice, makeQuantity(300, "g"));
    // Oldest-first regardless of input array order.
    expect(plan).toEqual({ allocations: [{ lotId: makeLotId("old"), amount: 300 }], shortfall: 0 });
  });

  it("BDD money-path: partial usage accumulates against the oldest lot across two use events", () => {
    const oldest = lot("old", "2026-01-01", 1000);
    const newer = lot("new", "2026-01-10", 500);

    const first = planFifoConsumption([oldest, newer], rice, makeQuantity(300, "g"));
    expect(first).toEqual({ allocations: [{ lotId: makeLotId("old"), amount: 300 }], shortfall: 0 });

    const afterFirst: Lot[] = [
      { ...oldest, quantity: makeQuantity(700, "g") },
      newer,
    ];
    const second = planFifoConsumption(afterFirst, rice, makeQuantity(800, "g"));
    expect(second).toEqual({
      allocations: [
        { lotId: makeLotId("old"), amount: 700 },
        { lotId: makeLotId("new"), amount: 100 },
      ],
      shortfall: 0,
    });
  });

  it("spans multiple lots and reports the shortfall when total stock is insufficient", () => {
    const a = lot("a", "2026-01-01", 100);
    const b = lot("b", "2026-01-05", 50);
    const plan = planFifoConsumption([a, b], rice, makeQuantity(500, "g"));
    expect(plan).toEqual({
      allocations: [
        { lotId: makeLotId("a"), amount: 100 },
        { lotId: makeLotId("b"), amount: 50 },
      ],
      shortfall: 350,
    });
  });

  it("breaks ties on equal purchaseDate by lotId ascending", () => {
    const b = lot("b-lot", "2026-01-01", 100);
    const a = lot("a-lot", "2026-01-01", 100);
    const plan = planFifoConsumption([b, a], rice, makeQuantity(150, "g"));
    expect(plan.allocations).toEqual([
      { lotId: makeLotId("a-lot"), amount: 100 },
      { lotId: makeLotId("b-lot"), amount: 50 },
    ]);
  });

  it("throws on a mixed-unit request against a matching-ingredient lot", () => {
    const gramsLot = lot("a", "2026-01-01", 100, "g");
    expect(() => planFifoConsumption([gramsLot], rice, makeQuantity(1, "ml"))).toThrow(
      /mixed units/i,
    );
  });
});
