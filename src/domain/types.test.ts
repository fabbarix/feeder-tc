import { describe, expect, it } from "vitest";
import {
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
} from "./types.ts";

describe("branded id constructors", () => {
  it.each([
    ["IngredientId", makeIngredientId],
    ["RecipeId", makeRecipeId],
    ["LotId", makeLotId],
    ["PlanSlotId", makePlanSlotId],
    ["EventId", makeEventId],
  ] as const)("%s: wraps a non-empty string", (_label, make) => {
    expect(make("abc-123")).toBe("abc-123");
  });

  it.each([
    ["IngredientId", makeIngredientId],
    ["RecipeId", makeRecipeId],
    ["LotId", makeLotId],
    ["PlanSlotId", makePlanSlotId],
    ["EventId", makeEventId],
  ] as const)("%s: rejects an empty or whitespace-only string", (_label, make) => {
    expect(() => make("")).toThrow();
    expect(() => make("   ")).toThrow();
  });

  it("two different id kinds are not interchangeable at compile time", () => {
    const ingredientId = makeIngredientId("rice");
    const recipeId = makeRecipeId("chili");
    // Both are structurally strings at runtime...
    expect(typeof ingredientId).toBe("string");
    expect(typeof recipeId).toBe("string");
    // ...but the type system keeps them apart: the following would be a
    // compile error if uncommented, which is exactly the point.
    // const wrong: typeof recipeId = ingredientId;
  });
});

describe("makeQuantity", () => {
  it("accepts a finite amount and unit", () => {
    expect(makeQuantity(400, "g")).toEqual({ amount: 400, unit: "g" });
  });

  it("accepts zero and negative amounts (deltas reuse this constructor)", () => {
    expect(makeQuantity(0, "g").amount).toBe(0);
    expect(makeQuantity(-50, "g").amount).toBe(-50);
  });

  it.each([NaN, Infinity, -Infinity])("rejects a non-finite amount (%s)", (amount) => {
    expect(() => makeQuantity(amount, "g")).toThrow();
  });
});

describe("makeIsoDate", () => {
  it("accepts a valid calendar date", () => {
    expect(makeIsoDate("2026-03-01")).toBe("2026-03-01");
  });

  it("rejects a malformed shape", () => {
    expect(() => makeIsoDate("2026/03/01")).toThrow();
    expect(() => makeIsoDate("26-03-01")).toThrow();
  });

  it("rejects an impossible calendar date", () => {
    expect(() => makeIsoDate("2026-02-30")).toThrow();
  });
});

describe("makeIsoTimestamp", () => {
  it("accepts a full ISO-8601 timestamp", () => {
    expect(makeIsoTimestamp("2026-03-01T09:00:00Z")).toBe("2026-03-01T09:00:00Z");
  });

  it("rejects a bare calendar date (no time component)", () => {
    expect(() => makeIsoTimestamp("2026-03-01")).toThrow();
  });
});
