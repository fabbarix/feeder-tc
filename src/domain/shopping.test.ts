import { describe, expect, it } from "vitest";
import {
  makeIngredientId,
  makeIsoDate,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type Lot,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type Settings,
} from "./types.ts";
import { computeShoppingList } from "./shopping.ts";

const rice = makeIngredientId("rice");
const riceRecipeId = makeRecipeId("recipe-rice");

const settings: Settings = { householdSize: 1, slotLayout: [], repeatExclusionWeeks: 3 };

function riceRecipe(baseServings: number): Recipe {
  return {
    id: riceRecipeId,
    name: "Rice bowl",
    kind: "cooked",
    baseServings,
    prepMinutes: 5,
    cookMinutes: 20,
    mealTags: ["dinner"],
    status: "in-rotation",
  };
}

describe("computeShoppingList (integration)", () => {
  it("the full loop: a planned week's need, minus zero pantry stock, is the whole list", () => {
    const lines: readonly RecipeIngredient[] = [
      { recipeId: riceRecipeId, ingredientId: rice, quantity: makeQuantity(400, "g") },
    ];
    const slots: readonly PlanSlot[] = [
      {
        id: makePlanSlotId("mon-dinner"),
        date: makeIsoDate("2026-08-24"),
        slotType: "dinner",
        slotIndex: 0,
        filling: { kind: "recipe", recipeId: riceRecipeId },
        state: "planned",
        pinned: false,
      },
    ];

    const result = computeShoppingList({
      range: { start: makeIsoDate("2026-08-24"), end: makeIsoDate("2026-08-30") },
      planSlots: slots,
      recipes: [riceRecipe(1)],
      recipeIngredients: lines,
      settings,
      lots: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.ingredientId).toBe(rice);
    expect(result[0]?.neededQuantity).toEqual(makeQuantity(400, "g"));
  });

  it("a multi-week range goes through the same code path as a single week", () => {
    const lines: readonly RecipeIngredient[] = [
      { recipeId: riceRecipeId, ingredientId: rice, quantity: makeQuantity(200, "g") },
    ];
    const slots: readonly PlanSlot[] = [
      {
        id: makePlanSlotId("week1-dinner"),
        date: makeIsoDate("2026-08-24"),
        slotType: "dinner",
        slotIndex: 0,
        filling: { kind: "recipe", recipeId: riceRecipeId },
        state: "planned",
        pinned: false,
      },
      {
        id: makePlanSlotId("week3-dinner"),
        date: makeIsoDate("2026-09-07"), // three weeks out — a "monthly" range
        slotType: "dinner",
        slotIndex: 0,
        filling: { kind: "recipe", recipeId: riceRecipeId },
        state: "planned",
        pinned: false,
      },
    ];

    const result = computeShoppingList({
      range: { start: makeIsoDate("2026-08-24"), end: makeIsoDate("2026-09-20") },
      planSlots: slots,
      recipes: [riceRecipe(1)],
      recipeIngredients: lines,
      settings,
      lots: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.neededQuantity).toEqual(makeQuantity(400, "g")); // 200 + 200
    expect(result[0]?.sources).toHaveLength(2);
  });

  it("stock exceeding total needs across the range leaves no line", () => {
    const lines: readonly RecipeIngredient[] = [
      { recipeId: riceRecipeId, ingredientId: rice, quantity: makeQuantity(200, "g") },
    ];
    const slots: readonly PlanSlot[] = [
      {
        id: makePlanSlotId("mon-dinner"),
        date: makeIsoDate("2026-08-24"),
        slotType: "dinner",
        slotIndex: 0,
        filling: { kind: "recipe", recipeId: riceRecipeId },
        state: "planned",
        pinned: false,
      },
    ];
    const lots: readonly Lot[] = [
      {
        id: makeLotId("lot-1"),
        ingredientId: rice,
        quantity: makeQuantity(1000, "g"),
        purchaseDate: makeIsoDate("2026-08-01"),
        location: "pantry",
        expiry: makeIsoDate("2026-12-01"),
        expiryOverridden: false,
      },
    ];

    const result = computeShoppingList({
      range: { start: makeIsoDate("2026-08-24"), end: makeIsoDate("2026-08-30") },
      planSlots: slots,
      recipes: [riceRecipe(1)],
      recipeIngredients: lines,
      settings,
      lots,
    });

    expect(result).toHaveLength(0);
  });
});
