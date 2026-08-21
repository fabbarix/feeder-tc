import { describe, expect, it } from "vitest";
import { leftoverIngredientId, resolveLeftoverIngredient } from "./leftover-ingredient.ts";
import { makeIngredientId, makeRecipeId } from "../../domain/index.ts";
import type { Ingredient, Recipe } from "../../domain/index.ts";

function recipe(name: string): Recipe {
  return {
    id: makeRecipeId("chili"),
    name,
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 10,
    cookMinutes: 30,
    mealTags: ["dinner"],
    status: "in-rotation",
  };
}

describe("leftoverIngredientId", () => {
  it("is a deterministic slug of the recipe name", () => {
    expect(leftoverIngredientId(recipe("Chili"))).toBe("leftover-chili");
  });

  it("is the same id for the same recipe name every time (idempotent)", () => {
    expect(leftoverIngredientId(recipe("Chili"))).toBe(leftoverIngredientId(recipe("Chili")));
  });
});

describe("resolveLeftoverIngredient", () => {
  it("builds a new 'Leftover: <recipe>' ingredient when none exists yet", () => {
    const result = resolveLeftoverIngredient(recipe("Chili"), []);
    expect(result.isNew).toBe(true);
    expect(result.ingredient.name).toBe("Leftover: Chili");
    expect(result.ingredient.unit).toBe("portion");
    expect(result.ingredient.id).toBe("leftover-chili");
  });

  it("reuses an existing catalog entry rather than minting a duplicate", () => {
    const existing: Ingredient = {
      id: makeIngredientId("leftover-chili"),
      name: "Leftover: Chili",
      unit: "portion",
      shelfLifeDays: 4,
      openedShelfLifeDays: 4,
      defaultLocation: "fridge",
    };
    const result = resolveLeftoverIngredient(recipe("Chili"), [existing]);
    expect(result.isNew).toBe(false);
    expect(result.ingredient).toBe(existing);
  });
});
