import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import {
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type Lot,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type Settings,
} from "../src/domain/types.ts";
import { computeShoppingList } from "../src/domain/shopping.ts";
import type { CheckOffInput, DateRange, ShoppingListLine } from "../src/domain/shopping-types.ts";
import { checkOffShoppingItem } from "../src/domain/shopping-checkoff.ts";
import { createFakeRng, createFixedClock } from "../src/domain/fakes/index.ts";

const feature = await loadFeature("./wp-14-shopping-list.feature");

// A fixed week, purely as concrete IsoDate stand-ins for the Gherkin's weekday
// names — the allocator only cares about relative order, not real weekdays.
const MONDAY = makeIsoDate("2026-08-24");
const TUESDAY = makeIsoDate("2026-08-25");
const WEDNESDAY = makeIsoDate("2026-08-26");
const THURSDAY = makeIsoDate("2026-08-27");
const FRIDAY = makeIsoDate("2026-08-28");
const SATURDAY = makeIsoDate("2026-08-29");
const SUNDAY = makeIsoDate("2026-08-30");
const THE_WEEK: DateRange = { start: MONDAY, end: SUNDAY };

const RICE = makeIngredientId("rice");

const SETTINGS: Settings = { householdSize: 1, slotLayout: [], repeatExclusionWeeks: 3 };

function recipe(id: string, ingredientId: string, amount: number, unit: "piece" | "g"): {
  recipe: Recipe;
  line: RecipeIngredient;
} {
  const recipeId = makeRecipeId(id);
  return {
    recipe: {
      id: recipeId,
      name: id,
      kind: "cooked",
      baseServings: 1,
      prepMinutes: 10,
      cookMinutes: 20,
      mealTags: ["breakfast", "lunch", "dinner", "snack"],
      status: "in-rotation",
    },
    line: { recipeId, ingredientId: makeIngredientId(ingredientId), quantity: makeQuantity(amount, unit) },
  };
}

function planSlot(id: string, date: ReturnType<typeof makeIsoDate>, slotType: "dinner" | "lunch", filling: PlanSlot["filling"]): PlanSlot {
  return {
    id: makePlanSlotId(id),
    date,
    slotType,
    slotIndex: 0,
    filling,
    state: "planned",
    pinned: false,
  };
}

function lot(id: string, ingredientId: string, amount: number, purchaseDate: ReturnType<typeof makeIsoDate>, expiry: ReturnType<typeof makeIsoDate>): Lot {
  return {
    id: makeLotId(id),
    ingredientId: makeIngredientId(ingredientId),
    quantity: makeQuantity(amount, "piece"),
    purchaseDate,
    location: "pantry",
    expiry,
    expiryOverridden: false,
  };
}

function findLine(lines: readonly ShoppingListLine[], ingredientId: string): ShoppingListLine | undefined {
  return lines.find((l) => l.ingredientId === makeIngredientId(ingredientId));
}

describeFeature(feature, ({ Scenario }) => {
  Scenario("Shared ingredient across recipes is aggregated", ({ Given, And, When, Then }) => {
    let recipes: Recipe[] = [];
    let lines: RecipeIngredient[] = [];
    let slots: PlanSlot[] = [];
    let lots: readonly Lot[] = [];
    let result: readonly ShoppingListLine[] = [];

    Given("Monday's dinner needs 2 tomatoes and Thursday's lunch needs 3 tomatoes", () => {
      const dinner = recipe("mon-dinner-recipe", "tomato", 2, "piece");
      const lunch = recipe("thu-lunch-recipe", "tomato", 3, "piece");
      recipes = [dinner.recipe, lunch.recipe];
      lines = [dinner.line, lunch.line];
      slots = [
        planSlot("mon-dinner", MONDAY, "dinner", { kind: "recipe", recipeId: dinner.recipe.id }),
        planSlot("thu-lunch", THURSDAY, "lunch", { kind: "recipe", recipeId: lunch.recipe.id }),
      ];
    });

    And("the pantry has no tomatoes", () => {
      lots = [];
    });

    When("the list for that week is computed", () => {
      result = computeShoppingList({
        range: THE_WEEK,
        planSlots: slots,
        recipes,
        recipeIngredients: lines,
        settings: SETTINGS,
        lots,
      });
    });

    Then('it contains one line "tomato: 5 piece" listing both meals', () => {
      expect(result).toHaveLength(1);
      const tomatoLine = findLine(result, "tomato");
      expect(tomatoLine?.neededQuantity).toEqual(makeQuantity(5, "piece"));
      expect(tomatoLine?.sources).toHaveLength(2);
    });
  });

  Scenario("Stock expiring before the cook date is not counted", ({ Given, And, When, Then }) => {
    let lots: Lot[] = [];
    let recipes: Recipe[] = [];
    let lines: RecipeIngredient[] = [];
    let slots: PlanSlot[] = [];
    let result: readonly ShoppingListLine[] = [];

    Given("a lot of 4 tomatoes expiring Tuesday", () => {
      lots = [lot("expiring-tue", "tomato", 4, MONDAY, TUESDAY)];
    });

    And("Friday's dinner needs 3 tomatoes", () => {
      const dinner = recipe("fri-dinner-recipe", "tomato", 3, "piece");
      recipes = [dinner.recipe];
      lines = [dinner.line];
      slots = [planSlot("fri-dinner", FRIDAY, "dinner", { kind: "recipe", recipeId: dinner.recipe.id })];
    });

    When("the list is computed", () => {
      result = computeShoppingList({
        range: THE_WEEK,
        planSlots: slots,
        recipes,
        recipeIngredients: lines,
        settings: SETTINGS,
        lots,
      });
    });

    Then('it contains "tomato: 3 piece"', () => {
      expect(findLine(result, "tomato")?.neededQuantity).toEqual(makeQuantity(3, "piece"));
    });
  });

  Scenario("Viable stock reduces the list FIFO by cook date", ({ Given, And, When, Then }) => {
    let lots: Lot[] = [];
    let recipes: Recipe[] = [];
    let lines: RecipeIngredient[] = [];
    let slots: PlanSlot[] = [];
    let result: readonly ShoppingListLine[] = [];

    Given("a lot of 4 tomatoes expiring Saturday", () => {
      lots = [lot("expiring-sat", "tomato", 4, MONDAY, SATURDAY)];
    });

    And("Tuesday's dinner needs 3 tomatoes and Friday's dinner needs 3 tomatoes", () => {
      const tue = recipe("tue-dinner-recipe", "tomato", 3, "piece");
      const fri = recipe("fri-dinner-recipe-2", "tomato", 3, "piece");
      recipes = [tue.recipe, fri.recipe];
      lines = [tue.line, fri.line];
      slots = [
        planSlot("tue-dinner", TUESDAY, "dinner", { kind: "recipe", recipeId: tue.recipe.id }),
        planSlot("fri-dinner", FRIDAY, "dinner", { kind: "recipe", recipeId: fri.recipe.id }),
      ];
    });

    When("the list is computed", () => {
      result = computeShoppingList({
        range: THE_WEEK,
        planSlots: slots,
        recipes,
        recipeIngredients: lines,
        settings: SETTINGS,
        lots,
      });
    });

    Then('it contains "tomato: 2 piece" attributed to Friday\'s dinner', () => {
      const tomatoLine = findLine(result, "tomato");
      expect(tomatoLine?.neededQuantity).toEqual(makeQuantity(2, "piece"));
      expect(tomatoLine?.sources).toHaveLength(1);
      expect(tomatoLine?.sources[0]?.date).toBe(FRIDAY);
      expect(tomatoLine?.sources[0]?.planSlotId).toBe("fri-dinner");
    });
  });

  Scenario("Leftover slots generate no needs", ({ Given, When, Then }) => {
    let slots: PlanSlot[] = [];
    let result: readonly ShoppingListLine[] = [];
    const chili = recipe("chili-recipe", "beans", 2, "piece");

    Given('Wednesday\'s dinner slot is "Leftover: Chili"', () => {
      slots = [
        planSlot("wed-dinner", WEDNESDAY, "dinner", {
          kind: "leftover",
          lotId: makeLotId("leftover-chili-lot"),
        }),
      ];
    });

    When("the list is computed", () => {
      result = computeShoppingList({
        range: THE_WEEK,
        planSlots: slots,
        recipes: [chili.recipe], // exists in the catalog, but nothing here references it as a "recipe" filling
        recipeIngredients: [chili.line],
        settings: SETTINGS,
        lots: [],
      });
    });

    Then("no ingredient from the Chili recipe is added for Wednesday", () => {
      expect(findLine(result, "beans")).toBeUndefined();
      expect(result.some((l) => l.sources.some((s) => s.date === WEDNESDAY))).toBe(false);
    });
  });

  Scenario("Check-off with a bigger package creates the full lot", ({ Given, When, Then }) => {
    let input!: CheckOffInput;
    let event!: ReturnType<typeof checkOffShoppingItem>;
    const today = makeIsoDate("2026-08-20");
    const clock = createFixedClock(makeIsoTimestamp("2026-08-20T09:00:00.000Z"), today);

    Given('the list contains "rice: 400 g"', () => {
      input = { ingredientId: RICE, neededQuantity: makeQuantity(400, "g"), location: "pantry" };
    });

    When("the user checks it off entering 1000 g", () => {
      event = checkOffShoppingItem(
        { ...input, actualQuantity: makeQuantity(1000, "g") },
        clock,
        createFakeRng(7),
      );
    });

    Then("a purchase event for 1000 g of rice is created dated today", () => {
      expect(event.type).toBe("purchase");
      expect(event.ingredientId).toBe(RICE);
      expect(event.quantity).toEqual(makeQuantity(1000, "g"));
      expect(event.purchaseDate).toBe(today);
    });
  });
});
