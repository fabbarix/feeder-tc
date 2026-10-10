import { describe, expect, it } from "vitest";
import { DEFAULT_MEAL_TYPES, isMealTagId, mealTypeName, mealTypesOf, newMealTypeId, servingsFor } from "./meal-types.ts";

const settings = {
  householdSize: 4,
  mealTypes: [
    { id: "breakfast", name: "Morning" },
    { id: "cats-breakfast", name: "Cat's breakfast", servings: 1 },
  ],
};

describe("meal types", () => {
  it("means the four defaults when a household never set its own", () => {
    expect(mealTypesOf({})).toBe(DEFAULT_MEAL_TYPES);
    expect(mealTypesOf(undefined).map((type) => type.id)).toEqual(["breakfast", "lunch", "dinner", "snack"]);
  });

  it("names a type by the household's name, falling back to the default name, then the id", () => {
    expect(mealTypeName(settings, "breakfast")).toBe("Morning");
    expect(mealTypeName(settings, "dinner")).toBe("Dinner");
    expect(mealTypeName(settings, "gone-type")).toBe("gone-type");
  });

  it("scales a type to its own servings, else the household size", () => {
    expect(servingsFor(settings, "cats-breakfast")).toBe(1);
    expect(servingsFor(settings, "breakfast")).toBe(4);
    expect(servingsFor(settings, "unknown")).toBe(4);
  });

  it("makes a readable, unique id from a name", () => {
    expect(newMealTypeId("Cat's breakfast", DEFAULT_MEAL_TYPES)).toBe("cats-breakfast");
    expect(newMealTypeId("Crème brûlée", [])).toBe("creme-brulee");
    expect(newMealTypeId("Snack", DEFAULT_MEAL_TYPES)).toBe("snack-2");
    expect(newMealTypeId("!!!", [])).toBe("meal");
    expect(isMealTagId(newMealTypeId("Kids' lunch (school)", []))).toBe(true);
  });
});
