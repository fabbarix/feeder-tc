import { describe, expect, it } from "vitest";
import { createFakeRng } from "../fakes/rng.ts";
import { makeIngredientId } from "../types.ts";
import {
  BASE_WEIGHT,
  EXPIRING_BOOST,
  OVERLAP_BOOST,
  recipeWeight,
  weightedPick,
} from "./weights.ts";

const chicken = makeIngredientId("chicken");
const rice = makeIngredientId("rice");
const tomato = makeIngredientId("tomato");

describe("recipeWeight ordering (WP-13 success criterion)", () => {
  it("baseline weight, no boosts, equals BASE_WEIGHT", () => {
    const weight = recipeWeight({
      recipeIngredientIds: new Set([rice]),
      expiringIngredientIds: new Set(),
      weekIngredientIds: new Set(),
    });
    expect(weight).toBe(BASE_WEIGHT);
  });

  it("overlap boost alone is strictly greater than the baseline", () => {
    const baseline = recipeWeight({
      recipeIngredientIds: new Set([rice]),
      expiringIngredientIds: new Set(),
      weekIngredientIds: new Set(),
    });
    const overlap = recipeWeight({
      recipeIngredientIds: new Set([rice]),
      expiringIngredientIds: new Set(),
      weekIngredientIds: new Set([rice]),
    });
    expect(overlap).toBeGreaterThan(baseline);
    expect(overlap).toBe(BASE_WEIGHT + OVERLAP_BOOST);
  });

  it("expiring boost alone is strictly greater than overlap boost alone", () => {
    const overlap = recipeWeight({
      recipeIngredientIds: new Set([rice]),
      expiringIngredientIds: new Set(),
      weekIngredientIds: new Set([rice]),
    });
    const expiring = recipeWeight({
      recipeIngredientIds: new Set([chicken]),
      expiringIngredientIds: new Set([chicken]),
      weekIngredientIds: new Set(),
    });
    expect(expiring).toBeGreaterThan(overlap);
    expect(expiring).toBe(BASE_WEIGHT + EXPIRING_BOOST);
  });

  it("full ordering: expiring boost > overlap boost > baseline", () => {
    const baseline = recipeWeight({
      recipeIngredientIds: new Set([tomato]),
      expiringIngredientIds: new Set(),
      weekIngredientIds: new Set(),
    });
    const overlap = recipeWeight({
      recipeIngredientIds: new Set([rice]),
      expiringIngredientIds: new Set(),
      weekIngredientIds: new Set([rice]),
    });
    const expiring = recipeWeight({
      recipeIngredientIds: new Set([chicken]),
      expiringIngredientIds: new Set([chicken]),
      weekIngredientIds: new Set(),
    });
    expect(expiring).toBeGreaterThan(overlap);
    expect(overlap).toBeGreaterThan(baseline);
  });

  it("both boosts stack when a recipe matches expiring and overlap", () => {
    const both = recipeWeight({
      recipeIngredientIds: new Set([chicken]),
      expiringIngredientIds: new Set([chicken]),
      weekIngredientIds: new Set([chicken]),
    });
    expect(both).toBe(BASE_WEIGHT + EXPIRING_BOOST + OVERLAP_BOOST);
  });

  it("is a pure function: same input always yields the same output", () => {
    const input = {
      recipeIngredientIds: new Set([chicken, rice]),
      expiringIngredientIds: new Set([chicken]),
      weekIngredientIds: new Set([tomato]),
    };
    expect(recipeWeight(input)).toBe(recipeWeight(input));
  });
});

describe("weightedPick", () => {
  it("throws on empty candidates", () => {
    expect(() => weightedPick([], [], createFakeRng())).toThrow();
  });

  it("throws on mismatched lengths", () => {
    expect(() => weightedPick(["a"], [1, 2], createFakeRng())).toThrow();
  });

  it("throws when total weight is not positive", () => {
    expect(() => weightedPick(["a", "b"], [0, 0], createFakeRng())).toThrow();
  });

  it("always returns the sole candidate when there is only one", () => {
    expect(weightedPick(["only"], [5], createFakeRng())).toBe("only");
  });

  it("is deterministic under a seeded Rng", () => {
    const items = ["a", "b", "c"];
    const weights = [1, 5, 10];
    const pick1 = weightedPick(items, weights, createFakeRng(7));
    const pick2 = weightedPick(items, weights, createFakeRng(7));
    expect(pick1).toBe(pick2);
  });

  it("heavily-weighted items win the overwhelming majority of draws", () => {
    const items = ["rare", "common"] as const;
    const weights = [1, 99];
    let rareCount = 0;
    let commonCount = 0;
    for (let seed = 0; seed < 500; seed += 1) {
      const picked = weightedPick(items, weights, createFakeRng(seed));
      if (picked === "rare") rareCount += 1;
      if (picked === "common") commonCount += 1;
    }
    expect(commonCount).toBeGreaterThan(rareCount * 10);
  });
});
