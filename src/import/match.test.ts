import { describe, expect, it } from "vitest";
import { makeIngredientId } from "../domain/types.ts";
import type { Ingredient } from "../domain/types.ts";
import {
  matchIngredientName,
  resolveImportedLine,
  resolveImportedLines,
  validateRecipeImportResponse,
  type ParsedIngredientLine,
} from "./match.ts";

function ingredient(overrides: Partial<Ingredient> & Pick<Ingredient, "id" | "name" | "unit">): Ingredient {
  return {
    shelfLifeDays: 30,
    openedShelfLifeDays: 5,
    defaultLocation: "pantry",
    ...overrides,
  };
}

const CATALOGUE: readonly Ingredient[] = [
  ingredient({ id: makeIngredientId("garlic"), name: "Garlic", unit: "g", gramsPerPiece: 5 }),
  ingredient({ id: makeIngredientId("flour"), name: "Plain flour", unit: "g" }),
  ingredient({ id: makeIngredientId("rice"), name: "Rice", unit: "g" }),
  ingredient({ id: makeIngredientId("milk"), name: "Milk", unit: "ml" }),
];

function line(overrides: Partial<ParsedIngredientLine>): ParsedIngredientLine {
  return { name: "Garlic", amount: 2, unit: "piece", note: "", ...overrides };
}

describe("matchIngredientName", () => {
  it("matches an exact (case-insensitive) name", () => {
    expect(matchIngredientName("garlic", CATALOGUE)?.name).toBe("Garlic");
  });

  it("matches a near-miss name via token similarity", () => {
    // "Plain flour" vs "flour, plain" — same tokens, different order/punctuation.
    expect(matchIngredientName("flour, plain", CATALOGUE)?.name).toBe("Plain flour");
  });

  it("does not match a name with no plausible candidate", () => {
    expect(matchIngredientName("saffron threads", CATALOGUE)).toBeUndefined();
  });

  it("does not match on a weak partial overlap (under-matching bias)", () => {
    // Shares no useful tokens with "Rice" beyond nothing — should stay unmatched
    // rather than guess.
    expect(matchIngredientName("wild rice blend with quinoa and lentils", CATALOGUE)).toBeUndefined();
  });
});

describe("resolveImportedLine", () => {
  it("pre-fills a confident match with a convertible unit", () => {
    const resolved = resolveImportedLine(line({ name: "garlic", amount: 2, unit: "piece" }), CATALOGUE, "k1");
    expect(resolved.matched).toBe(true);
    expect(resolved.ingredientId).toBe(makeIngredientId("garlic"));
    expect(resolved.amount).toBe(2);
    expect(resolved.entryUnit).toBe("piece");
  });

  it("leaves a no-match line unresolved, carrying the raw parse forward", () => {
    const resolved = resolveImportedLine(line({ name: "saffron threads", amount: 1, unit: "tsp" }), CATALOGUE, "k2");
    expect(resolved.matched).toBe(false);
    expect(resolved.ingredientId).toBeNull();
    expect(resolved.rawName).toBe("saffron threads");
    expect(resolved.amount).toBe(1);
    expect(resolved.entryUnit).toBe("tsp");
  });

  it("declines to pre-fill a unit the matched ingredient cannot represent (mass<->volume, no density)", () => {
    // "Rice" is mass-canonical (g) with no gramsPerMl set — a volume entry
    // (cup) cannot convert, and must never guess a density (units.ts's own rule).
    const resolved = resolveImportedLine(line({ name: "rice", amount: 1, unit: "cup" }), CATALOGUE, "k3");
    expect(resolved.matched).toBe(false);
    expect(resolved.ingredientId).toBeNull();
    expect(resolved.conversionNote).toBeDefined();
    // The raw reading must still be visible so the cook can enter it by hand.
    expect(resolved.amount).toBe(1);
    expect(resolved.entryUnit).toBe("cup");
  });

  it("pre-fills a line with no amount/unit at all (e.g. 'salt, to taste')", () => {
    const resolved = resolveImportedLine(line({ name: "garlic", amount: null, unit: null, note: "to taste" }), CATALOGUE, "k4");
    expect(resolved.matched).toBe(true);
    expect(resolved.ingredientId).toBe(makeIngredientId("garlic"));
    expect(resolved.amount).toBeNull();
  });

  it("resolveImportedLines mints stable, order-preserving keys", () => {
    const resolved = resolveImportedLines([line({ name: "garlic" }), line({ name: "milk", amount: 200, unit: "ml" })], CATALOGUE);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]!.key).not.toBe(resolved[1]!.key);
    expect(resolved[1]!.ingredientId).toBe(makeIngredientId("milk"));
  });
});

describe("validateRecipeImportResponse", () => {
  const VALID = {
    isRecipe: true,
    name: "Weeknight Garlic Rice",
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    ingredients: [{ name: "garlic", amount: 2, unit: "piece", note: "" }],
    steps: [{ description: "Cook the rice." }],
  };

  it("accepts a well-formed response", () => {
    const result = validateRecipeImportResponse(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.name).toBe("Weeknight Garlic Rice");
      expect(result.draft.ingredients).toHaveLength(1);
    }
  });

  it("rejects a response that isn't a recipe at all", () => {
    const result = validateRecipeImportResponse({ ...VALID, isRecipe: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/doesn't look like a recipe/);
  });

  it("rejects malformed JSON shapes (not an object)", () => {
    expect(validateRecipeImportResponse("just a string").ok).toBe(false);
    expect(validateRecipeImportResponse(null).ok).toBe(false);
    expect(validateRecipeImportResponse(42).ok).toBe(false);
  });

  it("rejects a response with a hallucinated unit outside the fixed enum", () => {
    const result = validateRecipeImportResponse({
      ...VALID,
      ingredients: [{ name: "garlic", amount: 2, unit: "clove", note: "" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a response with a non-numeric quantity (e.g. the model wrote 'a lot')", () => {
    const result = validateRecipeImportResponse({
      ...VALID,
      ingredients: [{ name: "garlic", amount: "a lot", unit: "piece", note: "" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a response missing the ingredients array entirely", () => {
    const withoutIngredients: Record<string, unknown> = { ...VALID };
    delete withoutIngredients.ingredients;
    const result = validateRecipeImportResponse(withoutIngredients);
    expect(result.ok).toBe(false);
  });
});
