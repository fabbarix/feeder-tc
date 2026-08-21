/**
 * `Ingredients` sheet codec tests (WP-VC3) — the `category` column added
 * for shopping-list grouping (types.ts's `Ingredient.category` doc comment).
 * The one thing this MUST get right: a legacy workbook row written before
 * this change has no `category` cell at all, and that must decode to
 * `undefined`, never throw / quarantine the row (HANDOVER.md invariant 5 —
 * "Sheets is the source of truth"; a real user's pre-existing workbook has
 * to keep loading).
 */
import { describe, expect, it } from "vitest";
import { makeIngredientId, type Ingredient } from "../../domain/types.ts";
import { decodeIngredient, encodeIngredient, INGREDIENTS_HEADER } from "./ingredients.ts";

const BASE: Omit<Ingredient, "category"> = {
  id: makeIngredientId("tomato"),
  name: "Tomato",
  unit: "piece",
  shelfLifeDays: 7,
  openedShelfLifeDays: 2,
  defaultLocation: "pantry",
};

describe("Ingredients codec — category column (WP-VC3)", () => {
  it("header row carries the new category column, appended at the end (additive)", () => {
    expect(INGREDIENTS_HEADER).toEqual([
      "id",
      "name",
      "unit",
      "shelf_life_days",
      "opened_shelf_life_days",
      "default_location",
      "category",
    ]);
  });

  it("encodes and decodes a row WITH a category — round trip is identity", () => {
    const ingredient: Ingredient = { ...BASE, category: "produce" };
    const row = encodeIngredient(ingredient);
    expect(row[6]).toBe("produce");
    expect(decodeIngredient(row)).toEqual(ingredient);
  });

  it("a LEGACY row with no category cell at all (row shorter than the new header) decodes category to undefined, not a thrown error", () => {
    // Exactly what a pre-WP-VC3 workbook has on disk: six cells, nothing in
    // the seventh position because the column didn't exist yet.
    const legacyRow = ["tomato", "Tomato", "piece", 7, 2, "pantry"];
    const decoded = decodeIngredient(legacyRow);
    expect(decoded.category).toBeUndefined();
    expect(decoded).toEqual(BASE);
  });

  it("a row with an explicitly blank category cell also decodes to undefined", () => {
    const row = ["tomato", "Tomato", "piece", 7, 2, "pantry", ""];
    expect(decodeIngredient(row).category).toBeUndefined();
  });

  it("a row with an unrecognised category value decodes to undefined rather than throwing (never quarantine over grouping metadata)", () => {
    const row = ["tomato", "Tomato", "piece", 7, 2, "pantry", "not-a-real-category"];
    expect(() => decodeIngredient(row)).not.toThrow();
    expect(decodeIngredient(row).category).toBeUndefined();
  });

  it("every recognised category value round-trips", () => {
    const categories = [
      "produce",
      "dairy-eggs",
      "meat-fish",
      "dry-goods",
      "tinned-jarred",
      "frozen",
      "condiments",
      "baking",
      "herbs-spices",
      "drinks",
    ] as const;
    for (const category of categories) {
      const ingredient: Ingredient = { ...BASE, category };
      expect(decodeIngredient(encodeIngredient(ingredient))).toEqual(ingredient);
    }
  });
});
