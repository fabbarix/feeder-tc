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
      "has_photo",
      "purchase_mode",
      "pack_size_amount",
      "pack_size_unit",
      "round_to",
      "grams_per_ml",
      "grams_per_piece",
      "pack_label",
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

describe("Ingredients codec — has_photo column (WP-PHOTO)", () => {
  it("a legacy row with no has_photo cell decodes hasPhoto to undefined, not a thrown error", () => {
    // Pre-WP-PHOTO shape: seven cells (through category), nothing in the
    // eighth position because the column didn't exist yet.
    const legacyRow = ["tomato", "Tomato", "piece", 7, 2, "pantry", "produce"];
    const decoded = decodeIngredient(legacyRow);
    expect(decoded.hasPhoto).toBeUndefined();
    expect(decoded).toEqual({ ...BASE, category: "produce" });
  });

  it("hasPhoto round-trips true and false", () => {
    for (const hasPhoto of [true, false]) {
      const ingredient: Ingredient = { ...BASE, hasPhoto };
      expect(decodeIngredient(encodeIngredient(ingredient))).toEqual(ingredient);
    }
  });
});

describe("Ingredients codec — purchasability columns (WP-PURCHASING)", () => {
  it("a legacy row with none of the new columns decodes every new field to undefined, not a thrown error", () => {
    // Pre-WP-PURCHASING shape: eight cells (through has_photo), nothing
    // beyond that because these columns didn't exist yet.
    const legacyRow = ["tomato", "Tomato", "piece", 7, 2, "pantry", "produce", true];
    const decoded = decodeIngredient(legacyRow);
    expect(decoded.purchaseMode).toBeUndefined();
    expect(decoded.packSize).toBeUndefined();
    expect(decoded.roundTo).toBeUndefined();
    expect(decoded.gramsPerMl).toBeUndefined();
    expect(decoded.gramsPerPiece).toBeUndefined();
    expect(decoded).toEqual({ ...BASE, category: "produce", hasPhoto: true });
  });

  it("encodes and decodes a whole-mode ingredient with a pack size — round trip is identity", () => {
    const ingredient: Ingredient = {
      ...BASE,
      unit: "g",
      purchaseMode: "whole",
      packSize: { amount: 250, unit: "g" },
    };
    const row = encodeIngredient(ingredient);
    expect(decodeIngredient(row)).toEqual(ingredient);
  });

  it("encodes and decodes a loose-mode ingredient with roundTo — round trip is identity", () => {
    const ingredient: Ingredient = { ...BASE, unit: "g", purchaseMode: "loose", roundTo: 50 };
    expect(decodeIngredient(encodeIngredient(ingredient))).toEqual(ingredient);
  });

  it("encodes and decodes gramsPerMl/gramsPerPiece — round trip is identity", () => {
    const ingredient: Ingredient = { ...BASE, unit: "g", gramsPerMl: 0.5417, gramsPerPiece: 120 };
    expect(decodeIngredient(encodeIngredient(ingredient))).toEqual(ingredient);
  });

  it("an unrecognised purchase_mode value decodes to undefined rather than throwing", () => {
    const row = ["tomato", "Tomato", "piece", 7, 2, "pantry", "", "", "not-a-mode"];
    expect(() => decodeIngredient(row)).not.toThrow();
    expect(decodeIngredient(row).purchaseMode).toBeUndefined();
  });

  it("a pack_size cell with a unit mismatching the ingredient's own unit is dropped rather than trusted blindly", () => {
    // pack_size_unit "ml" while the ingredient's canonical unit is "piece" —
    // invariant 3's spirit (one canonical unit) extends to this column too.
    const row = ["onion", "Onion", "piece", 30, 5, "pantry", "", "", "whole", 1, "ml"];
    expect(decodeIngredient(row).packSize).toBeUndefined();
  });
});

describe("Ingredients codec — pack_label column (WP-purchasing-editor)", () => {
  it("a LEGACY row written before pack_label existed decodes packLabel to undefined, not a thrown error", () => {
    // Pre-change shape: fourteen cells (through grams_per_piece), nothing in
    // the fifteenth position because the column didn't exist yet.
    const legacyRow = ["mayonnaise", "Mayonnaise", "g", 90, 30, "fridge", "condiments", "", "whole", 250, "g"];
    const decoded = decodeIngredient(legacyRow);
    expect(decoded.packLabel).toBeUndefined();
    expect(decoded).toEqual({
      ...BASE,
      id: makeIngredientId("mayonnaise"),
      name: "Mayonnaise",
      unit: "g",
      shelfLifeDays: 90,
      openedShelfLifeDays: 30,
      defaultLocation: "fridge",
      category: "condiments",
      purchaseMode: "whole",
      packSize: { amount: 250, unit: "g" },
    });
  });

  it("encodes and decodes a packLabel — round trip is identity", () => {
    const ingredient: Ingredient = {
      ...BASE,
      unit: "g",
      purchaseMode: "whole",
      packSize: { amount: 250, unit: "g" },
      packLabel: "jar",
    };
    const row = encodeIngredient(ingredient);
    expect(row[14]).toBe("jar");
    expect(decodeIngredient(row)).toEqual(ingredient);
  });

  it("an explicitly blank pack_label cell decodes to undefined, not an empty string", () => {
    const row = ["tomato", "Tomato", "piece", 7, 2, "pantry", "", "", "", "", "", "", "", "", ""];
    expect(decodeIngredient(row).packLabel).toBeUndefined();
  });
});
