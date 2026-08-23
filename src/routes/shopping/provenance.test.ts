import { describe, expect, it } from "vitest";
import {
  makeIngredientId,
  makeIsoDate,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type Ingredient,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type Settings,
} from "../../domain/index.ts";
import type { ShoppingListLine } from "../../domain/index.ts";
import {
  buildIndivisibleSecondary,
  buildProvenanceText,
  buildRoundingExplanation,
  buildWhyExplanation,
  sourceAmount,
} from "./provenance.ts";

const TOMATO = makeIngredientId("tomato");
const MONDAY_DINNER_RECIPE = makeRecipeId("monday-dinner-recipe");
const THURSDAY_LUNCH_RECIPE = makeRecipeId("thursday-lunch-recipe");
const MONDAY_SLOT = makePlanSlotId("slot-monday-dinner");
const THURSDAY_SLOT = makePlanSlotId("slot-thursday-lunch");

const SETTINGS: Settings = {
  householdSize: 4,
  slotLayout: [],
  repeatExclusionWeeks: 3,
};

const RECIPES: readonly Recipe[] = [
  {
    id: MONDAY_DINNER_RECIPE,
    name: "Tomato pasta",
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    mealTags: ["dinner"],
    status: "in-rotation",
  },
  {
    id: THURSDAY_LUNCH_RECIPE,
    name: "Tomato salad",
    kind: "cooked",
    baseServings: 2,
    prepMinutes: 5,
    cookMinutes: 0,
    mealTags: ["lunch"],
    status: "in-rotation",
  },
];

const RECIPE_INGREDIENTS: readonly RecipeIngredient[] = [
  { recipeId: MONDAY_DINNER_RECIPE, ingredientId: TOMATO, quantity: makeQuantity(2, "piece") },
  { recipeId: THURSDAY_LUNCH_RECIPE, ingredientId: TOMATO, quantity: makeQuantity(3, "piece") },
];

const PLAN_SLOTS: readonly PlanSlot[] = [
  {
    id: MONDAY_SLOT,
    date: makeIsoDate("2026-08-17"),
    slotType: "dinner",
    slotIndex: 0,
    filling: { kind: "recipe", recipeId: MONDAY_DINNER_RECIPE },
    state: "planned",
    pinned: false,
  },
  {
    id: THURSDAY_SLOT,
    date: makeIsoDate("2026-08-20"),
    slotType: "lunch",
    slotIndex: 0,
    filling: { kind: "recipe", recipeId: THURSDAY_LUNCH_RECIPE, scaleServings: 2 },
    state: "planned",
    pinned: false,
  },
];

const CTX = { planSlots: PLAN_SLOTS, recipes: RECIPES, recipeIngredients: RECIPE_INGREDIENTS, settings: SETTINGS };

const LINE: ShoppingListLine = {
  ingredientId: TOMATO,
  rangeStart: makeIsoDate("2026-08-17"),
  rangeEnd: makeIsoDate("2026-08-23"),
  neededQuantity: makeQuantity(5, "piece"),
  sources: [
    { planSlotId: MONDAY_SLOT, date: makeIsoDate("2026-08-17"), slotType: "dinner", slotIndex: 0, recipeId: MONDAY_DINNER_RECIPE },
    { planSlotId: THURSDAY_SLOT, date: makeIsoDate("2026-08-20"), slotType: "lunch", slotIndex: 0, recipeId: THURSDAY_LUNCH_RECIPE },
  ],
};

describe("sourceAmount", () => {
  it("scales by household size when no per-slot override is set", () => {
    // Monday dinner: 2 piece at baseServings 4, household 4 -> factor 1 -> 2.
    expect(sourceAmount(LINE.sources[0]!, TOMATO, CTX)).toBe(2);
  });

  it("scales by the slot's own scaleServings override when present", () => {
    // Thursday lunch: 3 piece at baseServings 2, scaleServings override 2 -> factor 1 -> 3.
    expect(sourceAmount(LINE.sources[1]!, TOMATO, CTX)).toBe(3);
  });
});

describe("buildProvenanceText", () => {
  it("short form matches the phone mock", () => {
    expect(buildProvenanceText(LINE.sources, "short")).toBe("Mon dinner · Thu lunch");
  });

  it("long form matches the desktop mock", () => {
    expect(buildProvenanceText(LINE.sources, "long")).toBe("Monday dinner · Thursday lunch");
  });
});

describe("buildWhyExplanation", () => {
  it("reads like the mock's 'Why 5 tomatoes?' card, naming each source's recipe", () => {
    expect(buildWhyExplanation(LINE, CTX)).toBe(
      "Monday dinner (Tomato pasta) needs 2, Thursday lunch (Tomato salad) needs 3, and what's already in the pantry won't still be good by those dates.",
    );
  });

  it("distinguishes two DIFFERENT recipes needing the same ingredient on the SAME day/slot (design review: two identical unlabelled clauses used to be indistinguishable)", () => {
    const chiliRecipe: Recipe = {
      id: makeRecipeId("chili"),
      name: "Chili",
      kind: "cooked",
      baseServings: 4,
      prepMinutes: 10,
      cookMinutes: 30,
      mealTags: ["dinner"],
      status: "in-rotation",
    };
    const stewRecipe: Recipe = {
      id: makeRecipeId("beef-stew"),
      name: "Beef stew",
      kind: "cooked",
      baseServings: 4,
      prepMinutes: 10,
      cookMinutes: 90,
      mealTags: ["dinner"],
      status: "in-rotation",
    };
    const onion = makeIngredientId("onion");
    const chiliSlot = makePlanSlotId("mon-dinner-chili");
    const stewSlot = makePlanSlotId("mon-dinner-stew");
    const monday = makeIsoDate("2026-08-17");
    const ctx = {
      planSlots: [
        { id: chiliSlot, date: monday, slotType: "dinner" as const, slotIndex: 0, filling: { kind: "recipe" as const, recipeId: chiliRecipe.id }, state: "planned" as const, pinned: false },
        { id: stewSlot, date: monday, slotType: "dinner" as const, slotIndex: 1, filling: { kind: "recipe" as const, recipeId: stewRecipe.id }, state: "planned" as const, pinned: false },
      ],
      recipes: [chiliRecipe, stewRecipe],
      recipeIngredients: [
        { recipeId: chiliRecipe.id, ingredientId: onion, quantity: makeQuantity(500, "g") },
        { recipeId: stewRecipe.id, ingredientId: onion, quantity: makeQuantity(100, "g") },
      ],
      settings: { householdSize: 4, slotLayout: [], repeatExclusionWeeks: 3 },
    };
    const onionLine: ShoppingListLine = {
      ingredientId: onion,
      rangeStart: monday,
      rangeEnd: monday,
      neededQuantity: makeQuantity(600, "g"),
      sources: [
        { planSlotId: chiliSlot, date: monday, slotType: "dinner", slotIndex: 0, recipeId: chiliRecipe.id },
        { planSlotId: stewSlot, date: monday, slotType: "dinner", slotIndex: 1, recipeId: stewRecipe.id },
      ],
    };
    const explanation = buildWhyExplanation(onionLine, ctx);
    expect(explanation).toContain("Monday dinner (Chili) needs 500");
    expect(explanation).toContain("Monday dinner (Beef stew) needs 100");
    // The two clauses must not collapse into the same unlabelled text.
    expect(explanation).not.toContain("Monday dinner needs 500, Monday dinner needs 100");
  });
});

// WP-PURCHASING (DESIGN_PURCHASING.md §6) — the extra "Why?" sentence.
describe("buildIndivisibleSecondary", () => {
  it("returns 'serves N, you need M' for a bought-meal line — the mock's Store lasagna row subtitle", () => {
    const lasagnaRecipe: Recipe = {
      id: makeRecipeId("store-lasagna"),
      name: "Store lasagna",
      kind: "bought",
      baseServings: 4,
      prepMinutes: 0,
      cookMinutes: 40,
      mealTags: ["dinner"],
      status: "in-rotation",
    };
    const lasagnaIngredientId = makeIngredientId("store-lasagna-product");
    const fridaySlot = makePlanSlotId("fri-dinner");
    const fridayDate = makeIsoDate("2026-08-21");
    const ctx = {
      planSlots: [
        {
          id: fridaySlot,
          date: fridayDate,
          slotType: "dinner" as const,
          slotIndex: 0,
          filling: { kind: "recipe" as const, recipeId: lasagnaRecipe.id },
          state: "planned" as const,
          pinned: false,
        },
      ],
      recipes: [lasagnaRecipe],
      recipeIngredients: [{ recipeId: lasagnaRecipe.id, ingredientId: lasagnaIngredientId, quantity: makeQuantity(1, "piece") }],
      settings: { householdSize: 2, slotLayout: [], repeatExclusionWeeks: 3 },
    };
    const lasagnaLine: ShoppingListLine = {
      ingredientId: lasagnaIngredientId,
      rangeStart: fridayDate,
      rangeEnd: fridayDate,
      neededQuantity: makeQuantity(1, "piece"),
      sources: [{ planSlotId: fridaySlot, date: fridayDate, slotType: "dinner", slotIndex: 0, recipeId: lasagnaRecipe.id }],
    };
    expect(buildIndivisibleSecondary(lasagnaLine, ctx)).toBe("serves 4, you need 2");
  });

  it("returns undefined for a plain (non-indivisible) line", () => {
    expect(buildIndivisibleSecondary(LINE, CTX)).toBeUndefined();
  });
});

describe("buildRoundingExplanation", () => {
  it("returns undefined once the line has been explicitly overridden — an explicit choice doesn't need defending (§6)", () => {
    const mayo: Ingredient = {
      id: makeIngredientId("mayo"),
      name: "Mayonnaise",
      unit: "g",
      shelfLifeDays: 90,
      openedShelfLifeDays: 30,
      defaultLocation: "fridge",
      purchaseMode: "whole",
      packSize: makeQuantity(250, "g"),
    };
    const overriddenLine: ShoppingListLine = {
      ...LINE,
      ingredientId: mayo.id,
      neededQuantity: makeQuantity(200, "g"),
      purchaseOverride: makeQuantity(500, "g"),
    };
    expect(buildRoundingExplanation(overriddenLine, mayo, CTX)).toBeUndefined();
  });

  it("explains a whole-pack rounding — the mock's mayonnaise sentence", () => {
    const mayo: Ingredient = {
      id: makeIngredientId("mayo"),
      name: "Mayonnaise",
      unit: "g",
      shelfLifeDays: 90,
      openedShelfLifeDays: 30,
      defaultLocation: "fridge",
      purchaseMode: "whole",
      packSize: makeQuantity(250, "g"),
    };
    const mayoLine: ShoppingListLine = { ...LINE, ingredientId: mayo.id, neededQuantity: makeQuantity(130, "g") };
    const explanation = buildRoundingExplanation(mayoLine, mayo, CTX);
    expect(explanation).toContain("130 g");
    expect(explanation).toContain("250 g");
    expect(explanation).toContain("surplus");
  });

  it("returns undefined when the buy amount already equals the need (nothing to explain)", () => {
    const mince: Ingredient = {
      id: makeIngredientId("mince"),
      name: "Mince",
      unit: "g",
      shelfLifeDays: 3,
      openedShelfLifeDays: 2,
      defaultLocation: "fridge",
    };
    const minceLine: ShoppingListLine = { ...LINE, ingredientId: mince.id, neededQuantity: makeQuantity(450, "g") };
    expect(buildRoundingExplanation(minceLine, mince, CTX)).toBeUndefined();
  });

  it("explains an indivisible recipe's servings/leftover forecast (§4/§6 — the lasagna sentence) instead of pack rounding", () => {
    const lasagnaRecipe: Recipe = {
      id: makeRecipeId("store-lasagna"),
      name: "Store lasagna",
      kind: "bought",
      baseServings: 4,
      prepMinutes: 0,
      cookMinutes: 40,
      mealTags: ["dinner"],
      status: "in-rotation",
    };
    const lasagnaIngredient: Ingredient = {
      id: makeIngredientId("store-lasagna-product"),
      name: "Store lasagna",
      unit: "piece",
      shelfLifeDays: 5,
      openedShelfLifeDays: 2,
      defaultLocation: "freezer",
    };
    const fridaySlot = makePlanSlotId("fri-dinner");
    const fridayDate = makeIsoDate("2026-08-21");
    const ctx = {
      planSlots: [
        {
          id: fridaySlot,
          date: fridayDate,
          slotType: "dinner" as const,
          slotIndex: 0,
          filling: { kind: "recipe" as const, recipeId: lasagnaRecipe.id },
          state: "planned" as const,
          pinned: false,
        },
      ],
      recipes: [lasagnaRecipe],
      recipeIngredients: [{ recipeId: lasagnaRecipe.id, ingredientId: lasagnaIngredient.id, quantity: makeQuantity(1, "piece") }],
      settings: { householdSize: 2, slotLayout: [], repeatExclusionWeeks: 3 },
    };
    const lasagnaLine: ShoppingListLine = {
      ingredientId: lasagnaIngredient.id,
      rangeStart: fridayDate,
      rangeEnd: fridayDate,
      neededQuantity: makeQuantity(1, "piece"),
      sources: [{ planSlotId: fridaySlot, date: fridayDate, slotType: "dinner", slotIndex: 0, recipeId: lasagnaRecipe.id }],
    };
    const explanation = buildRoundingExplanation(lasagnaLine, lasagnaIngredient, ctx);
    expect(explanation).toContain("can't be split");
    expect(explanation).toContain("leftover");
  });
});
