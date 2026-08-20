import { describe, expect, it } from "vitest";
import {
  makeIngredientId,
  makeIsoDate,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type Settings,
} from "../../domain/index.ts";
import type { ShoppingListLine } from "../../domain/index.ts";
import { buildProvenanceText, buildWhyExplanation, sourceAmount } from "./provenance.ts";

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
  it("reads like the mock's 'Why 5 tomatoes?' card", () => {
    expect(buildWhyExplanation(LINE, CTX)).toBe(
      "Monday dinner needs 2, Thursday lunch needs 3, and no viable lot expires on or after those dates.",
    );
  });
});
