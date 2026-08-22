import { describe, expect, it } from "vitest";
import { makeIngredientId, type Ingredient } from "../domain/index.ts";
import { gramsPreview, recipeEntryUnitsFor } from "./entry-units.ts";

function ingredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: makeIngredientId("test"),
    name: "Test",
    unit: "g",
    shelfLifeDays: 30,
    openedShelfLifeDays: 5,
    defaultLocation: "pantry",
    ...overrides,
  };
}

describe("recipeEntryUnitsFor", () => {
  it("a mass ingredient with no density offers only mass units (mass<->mass is free)", () => {
    const mince = ingredient({ name: "Mince", unit: "g" });
    expect(recipeEntryUnitsFor(mince)).toEqual(["kg", "g", "lb", "oz"]);
  });

  it("a mass ingredient with a density ALSO offers every volume unit — never a guessed density", () => {
    const flour = ingredient({ name: "Flour", unit: "g", gramsPerMl: 0.5417 });
    const units = recipeEntryUnitsFor(flour);
    expect(units).toContain("cup");
    expect(units).toContain("tbsp");
    expect(units).toContain("tsp");
    expect(units).toContain("g");
    expect(units).toContain("kg");
  });

  it("a mass ingredient with gramsPerPiece additionally offers piece (re-united produce, §9.1)", () => {
    const tomato = ingredient({ name: "Tomato", unit: "g", gramsPerPiece: 120 });
    expect(recipeEntryUnitsFor(tomato)).toContain("piece");
  });

  it("a volume ingredient offers only volume units, regardless of density", () => {
    const oil = ingredient({ name: "Oil", unit: "ml", gramsPerMl: 0.92 });
    expect(recipeEntryUnitsFor(oil)).toEqual(["l", "ml", "fl oz", "cup", "tbsp", "tsp"]);
  });

  it("a count ingredient offers only piece", () => {
    const onion = ingredient({ name: "Onion", unit: "piece", gramsPerPiece: 150 });
    expect(recipeEntryUnitsFor(onion)).toEqual(["piece"]);
  });

  it("a portion-unit ingredient offers nothing — no entry-time equivalent", () => {
    const leftover = ingredient({ name: "Leftover lot", unit: "portion" });
    expect(recipeEntryUnitsFor(leftover)).toEqual([]);
  });
});

describe("gramsPreview", () => {
  it("converts a cup entry into grams for a mass ingredient with a density set", () => {
    const flour = ingredient({ name: "Flour", unit: "g", gramsPerMl: 0.5417 });
    expect(gramsPreview(1, "cup", flour)).toBeCloseTo(130.008, 2);
  });

  it("is undefined when the typed unit already IS the canonical unit (nothing new to show)", () => {
    const mince = ingredient({ name: "Mince", unit: "g" });
    expect(gramsPreview(450, "g", mince)).toBeUndefined();
  });

  it("is undefined when the ingredient has no matching conversion constant — never a guess", () => {
    const mince = ingredient({ name: "Mince", unit: "g" });
    expect(gramsPreview(1, "cup", mince)).toBeUndefined();
  });

  it("multiplies a typed count by gramsPerPiece for a count-canonical ingredient (informational, storage stays in pieces)", () => {
    const onion = ingredient({ name: "Onion", unit: "piece", gramsPerPiece: 150 });
    expect(gramsPreview(2, "piece", onion)).toBe(300);
  });

  it("is undefined for a count-canonical ingredient with no gramsPerPiece set", () => {
    const bread = ingredient({ name: "Bread", unit: "piece" });
    expect(gramsPreview(1, "piece", bread)).toBeUndefined();
  });
});
