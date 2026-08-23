import { describe, expect, it } from "vitest";
import {
  aggregateByIngredient,
  aggregateByProduct,
  buildTrend,
  normalizedPointsFor,
  productSummariesForIngredient,
  sparklineValues,
} from "./price-history-aggregate.ts";
import {
  makeBarcode,
  makeIngredientId,
  makeIsoTimestamp,
  makePriceObservationId,
  makeProductId,
  makeQuantity,
  type Ingredient,
  type PriceObservation,
  type Product,
} from "../../domain/index.ts";

const RICE_ID = makeIngredientId("rice");
const MILK_ID = makeIngredientId("milk");
const RICE_BARCODE = makeBarcode("8001120000123");

const rice: Ingredient = {
  id: RICE_ID,
  name: "Rice",
  unit: "g",
  shelfLifeDays: 365,
  openedShelfLifeDays: 90,
  defaultLocation: "pantry",
};

const milk: Ingredient = {
  id: MILK_ID,
  name: "Milk",
  unit: "ml",
  shelfLifeDays: 10,
  openedShelfLifeDays: 3,
  defaultLocation: "fridge",
};

const riceGalloProduct: Product = {
  id: makeProductId("riso-gallo-arborio"),
  name: "Riso Gallo Arborio",
  brand: "Riso Gallo",
  ingredientId: RICE_ID,
  canonicalQuantity: makeQuantity(1000, "g"),
  displayQuantity: 1,
  displayUnit: "kg",
  shelfLifeDays: 730,
  isBulk: false,
  hasPhoto: false,
};

function observation(input: {
  id: string;
  timestamp: string;
  ingredientId: typeof RICE_ID;
  amount: number;
  unit: "g" | "ml" | "piece" | "portion";
  price: number;
  barcode?: typeof RICE_BARCODE;
}): PriceObservation {
  return {
    id: makePriceObservationId(input.id),
    timestamp: makeIsoTimestamp(input.timestamp),
    ingredientId: input.ingredientId,
    quantity: makeQuantity(input.amount, input.unit),
    price: input.price,
    ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
  };
}

describe("normalizedPointsFor", () => {
  it("returns an empty array for no observations", () => {
    expect(normalizedPointsFor([])).toEqual([]);
  });

  it("sorts oldest first regardless of input order", () => {
    const later = observation({ id: "b", timestamp: "2026-08-20T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.4 });
    const earlier = observation({ id: "a", timestamp: "2026-08-01T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.0 });
    const points = normalizedPointsFor([later, earlier]);
    expect(points.map((p) => p.observation.id)).toEqual(["a", "b"]);
  });

  it("skips a malformed observation (non-positive quantity) rather than throwing", () => {
    const bad = observation({ id: "bad", timestamp: "2026-08-01T10:00:00.000Z", ingredientId: RICE_ID, amount: 0, unit: "g", price: 2.0 });
    const good = observation({ id: "good", timestamp: "2026-08-02T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.0 });
    expect(normalizedPointsFor([bad, good]).map((p) => p.observation.id)).toEqual(["good"]);
  });
});

describe("buildTrend", () => {
  it("is 'none' for zero observations", () => {
    expect(buildTrend([])).toEqual({ kind: "none" });
  });

  it("is 'single' for exactly one observation — no trend is computable", () => {
    const points = normalizedPointsFor([
      observation({ id: "a", timestamp: "2026-08-01T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.4 }),
    ]);
    const trend = buildTrend(points);
    expect(trend.kind).toBe("single");
    if (trend.kind === "single") {
      expect(trend.latest.amount).toBeCloseTo(0.24, 5); // $2.40 / 1000g * 100
    }
  });

  it("is 'trend' with direction 'up' when the latest price rose", () => {
    const points = normalizedPointsFor([
      observation({ id: "a", timestamp: "2026-08-01T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.0 }),
      observation({ id: "b", timestamp: "2026-08-15T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.4 }),
    ]);
    const trend = buildTrend(points);
    expect(trend.kind).toBe("trend");
    if (trend.kind === "trend") {
      expect(trend.direction).toBe("up");
      expect(trend.deltaPct).toBeCloseTo(20, 5);
    }
  });

  it("is 'trend' with direction 'down' when the latest price fell", () => {
    const points = normalizedPointsFor([
      observation({ id: "a", timestamp: "2026-08-01T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 3.0 }),
      observation({ id: "b", timestamp: "2026-08-15T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.4 }),
    ]);
    const trend = buildTrend(points);
    expect(trend.kind).toBe("trend");
    if (trend.kind === "trend") expect(trend.direction).toBe("down");
  });

  it("is 'flat' for a change under the noise threshold", () => {
    const points = normalizedPointsFor([
      observation({ id: "a", timestamp: "2026-08-01T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.0 }),
      observation({ id: "b", timestamp: "2026-08-15T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.005 }),
    ]);
    const trend = buildTrend(points);
    expect(trend.kind).toBe("trend");
    if (trend.kind === "trend") expect(trend.direction).toBe("flat");
  });

  it("compares the latest against the immediately preceding observation, not the first", () => {
    const points = normalizedPointsFor([
      observation({ id: "a", timestamp: "2026-08-01T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 1.0 }),
      observation({ id: "b", timestamp: "2026-08-10T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 5.0 }),
      observation({ id: "c", timestamp: "2026-08-20T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 4.0 }),
    ]);
    const trend = buildTrend(points);
    expect(trend.kind).toBe("trend");
    // 4.0 vs 5.0 (the previous one) is a fall, even though 4.0 vs 1.0 (the
    // first ever) would read as a rise.
    if (trend.kind === "trend") {
      expect(trend.direction).toBe("down");
      expect(trend.previous.observation.id).toBe("b");
    }
  });
});

describe("aggregateByIngredient", () => {
  it("returns nothing for zero observations (the day-one case)", () => {
    const ingredientsById = new Map([[RICE_ID, rice]]);
    expect(aggregateByIngredient([], ingredientsById)).toEqual([]);
  });

  it("groups by ingredientId regardless of whether an observation names a product", () => {
    const observations = [
      observation({ id: "a", timestamp: "2026-08-01T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.0 }),
      observation({ id: "b", timestamp: "2026-08-10T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.4, barcode: RICE_BARCODE }),
      observation({ id: "c", timestamp: "2026-08-05T10:00:00.000Z", ingredientId: MILK_ID, amount: 1000, unit: "ml", price: 1.2 }),
    ];
    const ingredientsById = new Map([
      [RICE_ID, rice],
      [MILK_ID, milk],
    ]);
    const summaries = aggregateByIngredient(observations, ingredientsById);
    expect(summaries.map((s) => s.ingredient.name)).toEqual(["Milk", "Rice"]); // alphabetical
    const riceSummary = summaries.find((s) => s.ingredient.id === RICE_ID)!;
    expect(riceSummary.points).toHaveLength(2); // both the bare and the barcoded observation count
  });

  it("skips an observation whose ingredient no longer exists in the catalog", () => {
    const observations = [observation({ id: "a", timestamp: "2026-08-01T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.0 })];
    expect(aggregateByIngredient(observations, new Map())).toEqual([]);
  });
});

describe("aggregateByProduct / productSummariesForIngredient", () => {
  it("only includes observations that name a barcode, and only for a barcode with a matching Product row", () => {
    const observations = [
      observation({ id: "a", timestamp: "2026-08-01T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.0, barcode: RICE_BARCODE }),
      observation({ id: "b", timestamp: "2026-08-05T10:00:00.000Z", ingredientId: RICE_ID, amount: 1000, unit: "g", price: 2.1 }), // no barcode
    ];
    const productsByBarcode = new Map([[RICE_BARCODE, riceGalloProduct]]);
    const ingredientsById = new Map([[RICE_ID, rice]]);
    const summaries = aggregateByProduct(observations, productsByBarcode, ingredientsById);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.points).toHaveLength(1);
    expect(summaries[0]!.barcode).toBe(RICE_BARCODE);

    const forIngredient = productSummariesForIngredient(summaries, RICE_ID);
    expect(forIngredient).toHaveLength(1);
    expect(productSummariesForIngredient(summaries, MILK_ID)).toHaveLength(0);
  });
});

describe("sparklineValues", () => {
  it("caps to the last N points, oldest of those first", () => {
    const points = normalizedPointsFor(
      Array.from({ length: 5 }, (_, i) =>
        observation({
          id: `p${i}`,
          timestamp: `2026-08-0${i + 1}T10:00:00.000Z`,
          ingredientId: RICE_ID,
          amount: 1000,
          unit: "g",
          price: i + 1,
        }),
      ),
    );
    const values = sparklineValues(points, 3);
    expect(values).toHaveLength(3);
    // Last three prices normalised: 3.0, 4.0, 5.0 -> per-100g: 0.3, 0.4, 0.5
    expect(values[0]).toBeCloseTo(0.3, 5);
    expect(values[2]).toBeCloseTo(0.5, 5);
  });
});
