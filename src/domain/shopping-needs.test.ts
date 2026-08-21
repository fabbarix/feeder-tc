import { describe, expect, it } from "vitest";
import {
  makeIngredientId,
  makeIsoDate,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type Settings,
} from "./types.ts";
import { computeNeeds } from "./shopping-needs.ts";
import type { DateRange } from "./shopping-types.ts";

const tomato = makeIngredientId("tomato");
const rice = makeIngredientId("rice");
const dinnerRecipeId = makeRecipeId("recipe-dinner");
const lunchRecipeId = makeRecipeId("recipe-lunch");

function recipe(id: string, baseServings: number): Recipe {
  return {
    id: makeRecipeId(id),
    name: id,
    kind: "cooked",
    baseServings,
    prepMinutes: 10,
    cookMinutes: 20,
    mealTags: ["dinner", "lunch"],
    status: "in-rotation",
  };
}

function settings(householdSize: number): Settings {
  return { householdSize, slotLayout: [], repeatExclusionWeeks: 3 };
}

function slot(overrides: Partial<PlanSlot> & Pick<PlanSlot, "id" | "date" | "filling">): PlanSlot {
  return {
    slotType: "dinner",
    slotIndex: 0,
    state: "planned",
    pinned: false,
    ...overrides,
  };
}

const range: DateRange = { start: makeIsoDate("2026-08-24"), end: makeIsoDate("2026-08-30") };

describe("computeNeeds", () => {
  it("scales a recipe's ingredients by householdSize / baseServings", () => {
    const recipes: readonly Recipe[] = [recipe("recipe-dinner", 2)];
    const lines: readonly RecipeIngredient[] = [
      { recipeId: dinnerRecipeId, ingredientId: tomato, quantity: makeQuantity(2, "piece") },
    ];
    const slots: readonly PlanSlot[] = [
      slot({
        id: makePlanSlotId("s1"),
        date: makeIsoDate("2026-08-24"),
        filling: { kind: "recipe", recipeId: dinnerRecipeId },
      }),
    ];

    const needs = computeNeeds(range, slots, recipes, lines, settings(4));

    expect(needs).toHaveLength(1);
    expect(needs[0]?.ingredientId).toBe(tomato);
    expect(needs[0]?.quantity).toEqual(makeQuantity(4, "piece")); // 2 piece * (4/2)
  });

  it("a per-slot scaleServings override wins over householdSize", () => {
    const recipes: readonly Recipe[] = [recipe("recipe-dinner", 4)];
    const lines: readonly RecipeIngredient[] = [
      { recipeId: dinnerRecipeId, ingredientId: rice, quantity: makeQuantity(100, "g") },
    ];
    const slots: readonly PlanSlot[] = [
      slot({
        id: makePlanSlotId("s1"),
        date: makeIsoDate("2026-08-24"),
        filling: { kind: "recipe", recipeId: dinnerRecipeId, scaleServings: 2 },
      }),
    ];

    const needs = computeNeeds(range, slots, recipes, lines, settings(8));

    expect(needs[0]?.quantity).toEqual(makeQuantity(50, "g")); // 100g * (2/4), not 8/4
  });

  it("excludes leftover slots (no needs generated)", () => {
    const recipes: readonly Recipe[] = [recipe("recipe-dinner", 1)];
    const lines: readonly RecipeIngredient[] = [
      { recipeId: dinnerRecipeId, ingredientId: tomato, quantity: makeQuantity(1, "piece") },
    ];
    const slots: readonly PlanSlot[] = [
      slot({
        id: makePlanSlotId("s1"),
        date: makeIsoDate("2026-08-24"),
        filling: { kind: "leftover", lotId: makeLotId("lot-1") },
      }),
    ];

    expect(computeNeeds(range, slots, recipes, lines, settings(1))).toHaveLength(0);
  });

  it("excludes empty slots (no needs generated)", () => {
    const slots: readonly PlanSlot[] = [
      slot({ id: makePlanSlotId("s1"), date: makeIsoDate("2026-08-24"), filling: { kind: "empty" } }),
    ];

    expect(computeNeeds(range, slots, [], [], settings(1))).toHaveLength(0);
  });

  it("excludes skipped slots", () => {
    const recipes: readonly Recipe[] = [recipe("recipe-dinner", 1)];
    const lines: readonly RecipeIngredient[] = [
      { recipeId: dinnerRecipeId, ingredientId: tomato, quantity: makeQuantity(1, "piece") },
    ];
    const slots: readonly PlanSlot[] = [
      slot({
        id: makePlanSlotId("s1"),
        date: makeIsoDate("2026-08-24"),
        filling: { kind: "recipe", recipeId: dinnerRecipeId },
        state: "skipped",
      }),
    ];

    expect(computeNeeds(range, slots, recipes, lines, settings(1))).toHaveLength(0);
  });

  it("excludes slots outside the range", () => {
    const recipes: readonly Recipe[] = [recipe("recipe-dinner", 1)];
    const lines: readonly RecipeIngredient[] = [
      { recipeId: dinnerRecipeId, ingredientId: tomato, quantity: makeQuantity(1, "piece") },
    ];
    const slots: readonly PlanSlot[] = [
      slot({
        id: makePlanSlotId("s1"),
        date: makeIsoDate("2026-09-05"), // after range.end
        filling: { kind: "recipe", recipeId: dinnerRecipeId },
      }),
    ];

    expect(computeNeeds(range, slots, recipes, lines, settings(1))).toHaveLength(0);
  });

  it("emits one need per recipe-ingredient line, aggregating multiple slots", () => {
    const recipes: readonly Recipe[] = [recipe("recipe-dinner", 1), recipe("recipe-lunch", 1)];
    const lines: readonly RecipeIngredient[] = [
      { recipeId: dinnerRecipeId, ingredientId: tomato, quantity: makeQuantity(2, "piece") },
      { recipeId: lunchRecipeId, ingredientId: tomato, quantity: makeQuantity(3, "piece") },
    ];
    const slots: readonly PlanSlot[] = [
      slot({
        id: makePlanSlotId("mon-dinner"),
        date: makeIsoDate("2026-08-24"),
        filling: { kind: "recipe", recipeId: dinnerRecipeId },
      }),
      slot({
        id: makePlanSlotId("thu-lunch"),
        date: makeIsoDate("2026-08-27"),
        slotType: "lunch",
        filling: { kind: "recipe", recipeId: lunchRecipeId },
      }),
    ];

    const needs = computeNeeds(range, slots, recipes, lines, settings(1));

    expect(needs).toHaveLength(2);
    expect(needs.reduce((sum, n) => sum + n.quantity.amount, 0)).toBe(5);
  });

  it("scenario 1 (§5): a bought meal (indivisible by default) serving 4, household 2, scales to 1 whole unit — never 0.5", () => {
    const lasagna: Recipe = {
      id: makeRecipeId("store-lasagna"),
      name: "Store lasagna",
      kind: "bought",
      baseServings: 4,
      prepMinutes: 0,
      cookMinutes: 40,
      mealTags: ["dinner"],
      status: "in-rotation",
    };
    const lasagnaId = makeIngredientId("store-lasagna-product");
    const lines: readonly RecipeIngredient[] = [
      { recipeId: lasagna.id, ingredientId: lasagnaId, quantity: makeQuantity(1, "piece") },
    ];
    const slots: readonly PlanSlot[] = [
      slot({ id: makePlanSlotId("fri-dinner"), date: makeIsoDate("2026-08-28"), filling: { kind: "recipe", recipeId: lasagna.id } }),
    ];

    const needs = computeNeeds(range, slots, [lasagna], lines, settings(2));

    expect(needs).toHaveLength(1);
    // NOT 0.5 — the live defect this whole package fixes.
    expect(needs[0]?.quantity).toEqual(makeQuantity(1, "piece"));
  });

  it("scenario 2 (§5): a bought meal serving 2, household 5, scales to 3 whole units", () => {
    const lasagna: Recipe = {
      id: makeRecipeId("store-lasagna-2"),
      name: "Store lasagna",
      kind: "bought",
      baseServings: 2,
      prepMinutes: 0,
      cookMinutes: 40,
      mealTags: ["dinner"],
      status: "in-rotation",
    };
    const lasagnaId = makeIngredientId("store-lasagna-product-2");
    const lines: readonly RecipeIngredient[] = [
      { recipeId: lasagna.id, ingredientId: lasagnaId, quantity: makeQuantity(1, "piece") },
    ];
    const slots: readonly PlanSlot[] = [
      slot({ id: makePlanSlotId("fri-dinner"), date: makeIsoDate("2026-08-28"), filling: { kind: "recipe", recipeId: lasagna.id } }),
    ];

    const needs = computeNeeds(range, slots, [lasagna], lines, settings(5));

    expect(needs[0]?.quantity).toEqual(makeQuantity(3, "piece"));
  });

  it("a cooked recipe (not indivisible) still scales fractionally — the fix is scoped to indivisible recipes only", () => {
    const soup: Recipe = {
      id: makeRecipeId("soup"),
      name: "Soup",
      kind: "cooked",
      baseServings: 4,
      prepMinutes: 10,
      cookMinutes: 20,
      mealTags: ["dinner"],
      status: "in-rotation",
    };
    const lines: readonly RecipeIngredient[] = [
      { recipeId: soup.id, ingredientId: tomato, quantity: makeQuantity(2, "piece") },
    ];
    const slots: readonly PlanSlot[] = [
      slot({ id: makePlanSlotId("s1"), date: makeIsoDate("2026-08-24"), filling: { kind: "recipe", recipeId: soup.id } }),
    ];

    const needs = computeNeeds(range, slots, [soup], lines, settings(2));

    expect(needs[0]?.quantity).toEqual(makeQuantity(1, "piece")); // 2 * (2/4) = 1, fractional scaling untouched
  });

  it("a cooked recipe explicitly flagged indivisible: true also scales in whole units (§4/§8: the flag, not just kind, decides)", () => {
    const quiche: Recipe = {
      id: makeRecipeId("quiche"),
      name: "Quiche",
      kind: "cooked",
      baseServings: 4,
      prepMinutes: 20,
      cookMinutes: 40,
      mealTags: ["dinner"],
      status: "in-rotation",
      indivisible: true,
    };
    const lines: readonly RecipeIngredient[] = [
      { recipeId: quiche.id, ingredientId: tomato, quantity: makeQuantity(1, "piece") },
    ];
    const slots: readonly PlanSlot[] = [
      slot({ id: makePlanSlotId("s1"), date: makeIsoDate("2026-08-24"), filling: { kind: "recipe", recipeId: quiche.id } }),
    ];

    const needs = computeNeeds(range, slots, [quiche], lines, settings(2));

    expect(needs[0]?.quantity).toEqual(makeQuantity(1, "piece")); // ceil(2/4) = 1 whole quiche, not 0.5
  });

  it("throws when a slot references an unknown recipe", () => {
    const slots: readonly PlanSlot[] = [
      slot({
        id: makePlanSlotId("s1"),
        date: makeIsoDate("2026-08-24"),
        filling: { kind: "recipe", recipeId: dinnerRecipeId },
      }),
    ];

    expect(() => computeNeeds(range, slots, [], [], settings(1))).toThrow(/unknown recipe/);
  });
});
