import { describe, expect, it } from "vitest";
import {
  makeIngredientId,
  makeLotId,
  makeQuantity,
  makeRecipeId,
  type Recipe,
  type RecipeIngredient,
  type Settings,
} from "../types.ts";
import {
  resolveTargetServings,
  scaledRecipeIngredients,
  scaleQuantity,
  servingsScaleFactor,
} from "./scaling.ts";

describe("servingsScaleFactor", () => {
  it("computes target/base", () => {
    expect(servingsScaleFactor(4, 8)).toBe(2);
    expect(servingsScaleFactor(4, 2)).toBe(0.5);
  });

  it("rejects a non-positive base", () => {
    expect(() => servingsScaleFactor(0, 4)).toThrow();
    expect(() => servingsScaleFactor(-1, 4)).toThrow();
  });

  it("rejects a negative target", () => {
    expect(() => servingsScaleFactor(4, -1)).toThrow();
  });

  it("allows scaling to zero servings", () => {
    expect(servingsScaleFactor(4, 0)).toBe(0);
  });
});

describe("scaleQuantity", () => {
  it("multiplies the amount and preserves the unit — no conversion", () => {
    expect(scaleQuantity(makeQuantity(400, "g"), 2)).toEqual({ amount: 800, unit: "g" });
    expect(scaleQuantity(makeQuantity(2, "piece"), 1.5)).toEqual({ amount: 3, unit: "piece" });
  });
});

describe("resolveTargetServings", () => {
  const settings: Settings = { householdSize: 4, repeatExclusionWeeks: 3, slotLayout: [] };

  it("uses the per-slot override when present", () => {
    expect(
      resolveTargetServings(settings, {
        kind: "recipe",
        recipeId: makeRecipeId("chili"),
        scaleServings: 8,
      }),
    ).toBe(8);
  });

  it("falls back to household size when no override is set", () => {
    expect(resolveTargetServings(settings, { kind: "recipe", recipeId: makeRecipeId("chili") })).toBe(4);
  });

  it("is undefined for leftover and empty fillings", () => {
    expect(resolveTargetServings(settings, { kind: "empty" })).toBeUndefined();
    expect(
      resolveTargetServings(settings, { kind: "leftover", lotId: makeLotId("lot") }),
    ).toBeUndefined();
  });
});

describe("scaledRecipeIngredients", () => {
  const chili: Recipe = {
    id: makeRecipeId("chili"),
    name: "Chili",
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 10,
    cookMinutes: 40,
    mealTags: ["dinner"],
    status: "in-rotation",
  };
  const lines: RecipeIngredient[] = [
    { recipeId: chili.id, ingredientId: makeIngredientId("beans"), quantity: makeQuantity(400, "g") },
    { recipeId: chili.id, ingredientId: makeIngredientId("tomato"), quantity: makeQuantity(3, "piece") },
    // Another recipe's line must be ignored.
    { recipeId: makeRecipeId("other"), ingredientId: makeIngredientId("rice"), quantity: makeQuantity(1000, "g") },
  ];

  it("scales every ingredient line for the recipe to the target servings", () => {
    const scaled = scaledRecipeIngredients(chili, lines, 8);
    expect(scaled).toEqual([
      { ingredientId: makeIngredientId("beans"), quantity: { amount: 800, unit: "g" } },
      { ingredientId: makeIngredientId("tomato"), quantity: { amount: 6, unit: "piece" } },
    ]);
  });
});
