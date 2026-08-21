/**
 * Purchasability engine tests (WP-PURCHASING). DESIGN_PURCHASING.md §5's
 * twelve-scenario table is the acceptance criteria for this whole package;
 * every row that can be exercised as a pure unit test is covered here or in
 * `shopping-allocate.test.ts`/`shopping-needs.test.ts` (aggregation/FIFO
 * ordering) — see this repo's PR description for the row-by-row map.
 */
import { describe, expect, it } from "vitest";
import { makeBarcode, makeIngredientId, makeQuantity, makeRecipeId, type Ingredient, type Product, type Recipe } from "./types.ts";
import { defaultPurchaseMode, isIndivisible, scaleIndivisible, suggestPurchase, withPurchaseOverride } from "./purchasing.ts";

function ingredient(overrides: Partial<Ingredient> & Pick<Ingredient, "unit">): Ingredient {
  return {
    id: makeIngredientId("test-ingredient"),
    name: "Test ingredient",
    shelfLifeDays: 10,
    openedShelfLifeDays: 5,
    defaultLocation: "pantry",
    ...overrides,
  };
}

function recipe(overrides: Partial<Recipe> & Pick<Recipe, "baseServings" | "kind">): Recipe {
  return {
    id: makeRecipeId("test-recipe"),
    name: "Test recipe",
    prepMinutes: 0,
    cookMinutes: 30,
    mealTags: ["dinner"],
    status: "in-rotation",
    ...overrides,
  };
}

describe("defaultPurchaseMode (§3's zero-migration defaults)", () => {
  it("defaults piece to whole", () => {
    expect(defaultPurchaseMode(ingredient({ unit: "piece" }))).toBe("whole");
  });

  it("defaults portion to whole", () => {
    expect(defaultPurchaseMode(ingredient({ unit: "portion" }))).toBe("whole");
  });

  it("defaults g to loose", () => {
    expect(defaultPurchaseMode(ingredient({ unit: "g" }))).toBe("loose");
  });

  it("defaults ml to loose", () => {
    expect(defaultPurchaseMode(ingredient({ unit: "ml" }))).toBe("loose");
  });

  it("an explicit purchaseMode overrides the unit-derived default", () => {
    expect(defaultPurchaseMode(ingredient({ unit: "g", purchaseMode: "whole" }))).toBe("whole");
    expect(defaultPurchaseMode(ingredient({ unit: "piece", purchaseMode: "loose" }))).toBe("loose");
  });
});

describe("suggestPurchase — §5 scenario table", () => {
  it("scenario 3: needs ½ onion -> buy 1 onion, ½ surplus to pantry", () => {
    const onion = ingredient({ unit: "piece" });
    const result = suggestPurchase(makeQuantity(0.5, "piece"), onion);
    expect(result.mode).toBe("whole");
    expect(result.quantity).toEqual(makeQuantity(1, "piece"));
    expect(result.surplus).toEqual(makeQuantity(0.5, "piece"));
  });

  it("scenario 4: three meals' worth of ½ onion, aggregated to 1.5 -> buy 2 onions (rounded once, on the aggregate)", () => {
    const onion = ingredient({ unit: "piece" });
    const result = suggestPurchase(makeQuantity(1.5, "piece"), onion);
    expect(result.quantity).toEqual(makeQuantity(2, "piece"));
    expect(result.units).toBe(2);
  });

  it("scenario 5: needs 50 g mayo, jar is 250 g -> buy 1 jar (250 g)", () => {
    const mayo = ingredient({ unit: "g", purchaseMode: "whole", packSize: makeQuantity(250, "g") });
    const result = suggestPurchase(makeQuantity(50, "g"), mayo);
    expect(result.quantity).toEqual(makeQuantity(250, "g"));
    expect(result.units).toBe(1);
    expect(result.surplus).toEqual(makeQuantity(200, "g"));
  });

  it("scenario 6: three meals x 50 g mayo aggregated to 150 g -> still buy 1 jar, not 3", () => {
    const mayo = ingredient({ unit: "g", purchaseMode: "whole", packSize: makeQuantity(250, "g") });
    const result = suggestPurchase(makeQuantity(150, "g"), mayo);
    expect(result.units).toBe(1);
    expect(result.quantity).toEqual(makeQuantity(250, "g"));
  });

  it("scenario 7: needs 300 g mayo, jar is 250 g -> buy 2 jars (500 g)", () => {
    const mayo = ingredient({ unit: "g", purchaseMode: "whole", packSize: makeQuantity(250, "g") });
    const result = suggestPurchase(makeQuantity(300, "g"), mayo);
    expect(result.units).toBe(2);
    expect(result.quantity).toEqual(makeQuantity(500, "g"));
    expect(result.surplus).toEqual(makeQuantity(200, "g"));
  });

  it("scenario 8: needs 300 g, 200 g already in pantry -> shortfall 100 g -> buy 1 jar (rounding happens AFTER stock subtraction, on the 100 g shortfall the caller passes in)", () => {
    const mayo = ingredient({ unit: "g", purchaseMode: "whole", packSize: makeQuantity(250, "g") });
    // The 100 g shortfall is what a caller (allocateShoppingList) would pass
    // in here, already having subtracted the 200 g pantry stock — this test
    // documents that `suggestPurchase` itself has no stock-subtraction
    // logic of its own, it only ever sees the post-subtraction shortfall.
    const result = suggestPurchase(makeQuantity(100, "g"), mayo);
    expect(result.units).toBe(1);
    expect(result.quantity).toEqual(makeQuantity(250, "g"));
  });

  it("scenario 10: loose goods with no pack size set -> buy exactly the need, unchanged", () => {
    const mince = ingredient({ unit: "g" });
    const result = suggestPurchase(makeQuantity(237, "g"), mince);
    expect(result.mode).toBe("loose");
    expect(result.quantity).toEqual(makeQuantity(237, "g"));
    expect(result.surplus).toEqual(makeQuantity(0, "g"));
  });

  it("scenario 10 (roundTo variant): loose goods with a roundTo step round up to the nearest multiple", () => {
    const mince = ingredient({ unit: "g", roundTo: 50 });
    const result = suggestPurchase(makeQuantity(237, "g"), mince);
    expect(result.quantity).toEqual(makeQuantity(250, "g"));
  });

  it("a loose ingredient exactly on a roundTo boundary doesn't round up further", () => {
    const mince = ingredient({ unit: "g", roundTo: 50 });
    const result = suggestPurchase(makeQuantity(250, "g"), mince);
    expect(result.quantity).toEqual(makeQuantity(250, "g"));
  });

  it("a whole-mode need that's already an exact multiple of the pack doesn't round up further", () => {
    const mayo = ingredient({ unit: "g", purchaseMode: "whole", packSize: makeQuantity(250, "g") });
    const result = suggestPurchase(makeQuantity(500, "g"), mayo);
    expect(result.units).toBe(2);
    expect(result.surplus).toEqual(makeQuantity(0, "g"));
  });

  it("a known Product's canonicalQuantity overrides the ingredient's typical packSize (§3)", () => {
    const mayo = ingredient({ unit: "g", purchaseMode: "whole", packSize: makeQuantity(250, "g") });
    const product: Product = {
      barcode: makeBarcode("8001120000123"),
      name: "Big Jar Mayo",
      ingredientId: mayo.id,
      canonicalQuantity: makeQuantity(500, "g"),
      displayQuantity: 500,
      displayUnit: "g",
      shelfLifeDays: 90,
      isBulk: false,
      hasPhoto: false,
    };
    const result = suggestPurchase(makeQuantity(300, "g"), mayo, product);
    expect(result.packSize).toEqual(makeQuantity(500, "g"));
    expect(result.units).toBe(1);
    expect(result.quantity).toEqual(makeQuantity(500, "g"));
  });

  it("rejects a need whose unit doesn't match the ingredient's canonical unit (invariant 3)", () => {
    const mince = ingredient({ unit: "g" });
    expect(() => suggestPurchase(makeQuantity(2, "piece"), mince)).toThrow(/mixed units/i);
  });

  it("surplus is never negative, even at the exact need", () => {
    const onion = ingredient({ unit: "piece" });
    const result = suggestPurchase(makeQuantity(2, "piece"), onion);
    expect(result.surplus.amount).toBeGreaterThanOrEqual(0);
  });
});

describe("scaleIndivisible — §4 (symptom 1's honest fix)", () => {
  it("scenario 1: lasagna serves 4, household 2 -> 1 unit, 4 produced, 2 leftover", () => {
    const lasagna = recipe({ kind: "bought", baseServings: 4 });
    const scaling = scaleIndivisible(lasagna, 2);
    expect(scaling.units).toBe(1);
    expect(scaling.producedServings).toBe(4);
    expect(scaling.surplusServings).toBe(2);
  });

  it("scenario 2: lasagna serves 2, household 5 -> 3 units, 6 produced, 1 leftover", () => {
    const lasagna = recipe({ kind: "bought", baseServings: 2 });
    const scaling = scaleIndivisible(lasagna, 5);
    expect(scaling.units).toBe(3);
    expect(scaling.producedServings).toBe(6);
    expect(scaling.surplusServings).toBe(1);
  });

  it("an exact multiple produces zero surplus", () => {
    const lasagna = recipe({ kind: "bought", baseServings: 4 });
    const scaling = scaleIndivisible(lasagna, 8);
    expect(scaling.units).toBe(2);
    expect(scaling.surplusServings).toBe(0);
  });

  it("household 9 against baseServings 4 (§4's own household-9 example) -> 3 units, 12 produced, 3 leftover", () => {
    const lasagna = recipe({ kind: "bought", baseServings: 4 });
    const scaling = scaleIndivisible(lasagna, 9);
    expect(scaling.units).toBe(3);
    expect(scaling.producedServings).toBe(12);
    expect(scaling.surplusServings).toBe(3);
  });

  it("throws for a non-positive baseServings", () => {
    const bad = recipe({ kind: "bought", baseServings: 0 });
    expect(() => scaleIndivisible(bad, 4)).toThrow(/baseServings/);
  });

  it("throws for a non-positive targetServings", () => {
    const lasagna = recipe({ kind: "bought", baseServings: 4 });
    expect(() => scaleIndivisible(lasagna, 0)).toThrow();
    expect(() => scaleIndivisible(lasagna, -1)).toThrow();
  });
});

describe("isIndivisible (§4/§8 default)", () => {
  it("defaults true for kind: bought", () => {
    expect(isIndivisible(recipe({ kind: "bought", baseServings: 4 }))).toBe(true);
  });

  it("defaults false for kind: cooked", () => {
    expect(isIndivisible(recipe({ kind: "cooked", baseServings: 4 }))).toBe(false);
  });

  it("an explicit indivisible flag overrides the kind-derived default, both ways", () => {
    expect(isIndivisible(recipe({ kind: "cooked", baseServings: 4, indivisible: true }))).toBe(true);
    expect(isIndivisible(recipe({ kind: "bought", baseServings: 4, indivisible: false }))).toBe(false);
  });
});

interface TestLine {
  readonly neededQuantity: ReturnType<typeof makeQuantity>;
  readonly purchaseOverride?: ReturnType<typeof makeQuantity>;
}

describe("withPurchaseOverride (§6 scenario 9 / §7)", () => {
  it("leaves a line untouched when there is no override", () => {
    const line: TestLine = { neededQuantity: makeQuantity(200, "g") };
    expect(withPurchaseOverride(line, undefined)).toBe(line);
  });

  it("scenario 9: merges a household override (500 g against a 200 g need) onto the line", () => {
    const line: TestLine = { neededQuantity: makeQuantity(200, "g") };
    const merged = withPurchaseOverride(line, makeQuantity(500, "g"));
    expect(merged.purchaseOverride).toEqual(makeQuantity(500, "g"));
    // surplus a caller would display: 500 - 200 = 300 g (§5 scenario 9).
    expect((merged.purchaseOverride?.amount ?? 0) - merged.neededQuantity.amount).toBe(300);
  });
});
