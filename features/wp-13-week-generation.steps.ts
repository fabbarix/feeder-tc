import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { createFakeRng } from "../src/domain/fakes/rng.ts";
import {
  makeIngredientId,
  makeIsoDate,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type MealTag,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type RecipeStatus,
  type Settings,
} from "../src/domain/types.ts";
import { generateWeek } from "../src/domain/planner/generator.ts";

const feature = await loadFeature("./wp-13-week-generation.feature");

const WEEK_START = makeIsoDate("2026-08-17"); // a Monday
const NEXT_WEEK_START = makeIsoDate("2026-08-24");

function recipe(id: string, mealTags: readonly MealTag[], status: RecipeStatus): Recipe {
  return {
    id: makeRecipeId(id),
    name: id,
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    mealTags,
    status,
  };
}

function sevenDinnerSlotsSettings(repeatExclusionWeeks = 3): Settings {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
  return {
    householdSize: 4,
    repeatExclusionWeeks,
    slotLayout: days.map((day) => ({ day, slots: ["dinner"] as MealTag[] })),
  };
}

function placedRecipeIds(slots: readonly PlanSlot[]): (string | undefined)[] {
  return slots.map((s) => (s.filling.kind === "recipe" ? s.filling.recipeId : undefined));
}

describeFeature(feature, ({ Scenario }) => {
  Scenario("Staples are guaranteed before random fill", ({ Given, When, Then }) => {
    let recipes: Recipe[];
    let resultSlots: readonly PlanSlot[];

    Given("2 staple dinner recipes and 10 in-rotation dinner recipes", () => {
      const staples = [recipe("staple-1", ["dinner"], "staple"), recipe("staple-2", ["dinner"], "staple")];
      const rotation = Array.from({ length: 10 }, (_, i) => recipe(`rot-${i}`, ["dinner"], "in-rotation"));
      recipes = [...staples, ...rotation];
    });

    When("a week with 7 dinner slots is generated", () => {
      const result = generateWeek({
        settings: sevenDinnerSlotsSettings(),
        weekStart: WEEK_START,
        recipes,
        recipeIngredients: [],
        pastPlanSlots: [],
        expiringIngredientIds: new Set(),
        rng: createFakeRng(1),
      });
      resultSlots = result.slots;
    });

    Then("both staples appear exactly once", () => {
      const ids = placedRecipeIds(resultSlots);
      expect(ids.filter((id) => id === "staple-1")).toHaveLength(1);
      expect(ids.filter((id) => id === "staple-2")).toHaveLength(1);
    });
  });

  Scenario("More staples than slots round-robins across weeks", ({ Given, When, Then, And }) => {
    let staples: Recipe[];
    let week1Ids: Set<string>;
    let week2Ids: Set<string>;

    Given("9 staple dinner recipes and a 7-dinner week", () => {
      staples = Array.from({ length: 9 }, (_, i) => recipe(`staple-${i}`, ["dinner"], "staple"));
    });

    When("two consecutive weeks are generated", () => {
      const settings = sevenDinnerSlotsSettings();
      const week1 = generateWeek({
        settings,
        weekStart: WEEK_START,
        recipes: staples,
        recipeIngredients: [],
        pastPlanSlots: [],
        expiringIngredientIds: new Set(),
        rng: createFakeRng(2),
      });
      const week2 = generateWeek({
        settings,
        weekStart: NEXT_WEEK_START,
        recipes: staples,
        recipeIngredients: [],
        pastPlanSlots: [],
        expiringIngredientIds: new Set(),
        staplePlanState: week1.staplePlanState,
        rng: createFakeRng(3),
      });
      week1Ids = new Set(
        placedRecipeIds(week1.slots).filter((id): id is string => id !== undefined),
      );
      week2Ids = new Set(
        placedRecipeIds(week2.slots).filter((id): id is string => id !== undefined),
      );
    });

    Then("every staple appears at least once across the two weeks", () => {
      for (const s of staples) {
        expect(week1Ids.has(s.id) || week2Ids.has(s.id)).toBe(true);
      }
    });

    And("no staple appears twice before all have appeared once", () => {
      // week1 and week2 partition the 9 staples with no overlap: nothing
      // placed in week2 was already placed in week1, so nothing repeated
      // before the full set (all 9) had appeared once.
      for (const id of week2Ids) {
        expect(week1Ids.has(id)).toBe(false);
      }
      expect(week1Ids.size + week2Ids.size).toBe(9);
    });
  });

  Scenario("Recently cooked recipes are excluded", ({ Given, When, Then }) => {
    let recipes: Recipe[];
    let pastSlots: PlanSlot[];
    let resultsAcrossSeeds: (string | undefined)[][];

    Given('"Carbonara" was cooked 1 week ago and the exclusion window is 3 weeks', () => {
      recipes = [recipe("Carbonara", ["dinner"], "in-rotation"), recipe("other", ["dinner"], "in-rotation")];
      pastSlots = [
        {
          id: makePlanSlotId("past-carbonara"),
          date: makeIsoDate("2026-08-10"), // 1 week before WEEK_START
          slotType: "dinner",
          slotIndex: 0,
          filling: { kind: "recipe", recipeId: makeRecipeId("Carbonara") },
          state: "cooked",
          pinned: false,
        },
      ];
    });

    When("a week is generated", () => {
      resultsAcrossSeeds = [];
      for (let seed = 0; seed < 20; seed += 1) {
        const result = generateWeek({
          settings: sevenDinnerSlotsSettings(3),
          weekStart: WEEK_START,
          recipes,
          recipeIngredients: [],
          pastPlanSlots: pastSlots,
          expiringIngredientIds: new Set(),
          rng: createFakeRng(seed),
        });
        resultsAcrossSeeds.push(placedRecipeIds(result.slots));
      }
    });

    Then('"Carbonara" is not selected for any slot', () => {
      for (const ids of resultsAcrossSeeds) {
        expect(ids.includes("Carbonara")).toBe(false);
      }
    });
  });

  Scenario("Expiring pantry lots boost matching recipes", ({ Given, When, Then, And }) => {
    const chicken = makeIngredientId("chicken");
    let recipes: Recipe[];
    let recipeIngredients: RecipeIngredient[];
    let roastCount: number;
    let baselineCount: number;

    Given("a lot of chicken expires this week", () => {
      // The expiring ingredient set is the generator's input for this signal
      // (WP-13 stays pure and takes it from the inventory engine's output,
      // rather than importing WP-12) — captured when building the recipes below.
    });

    And('"Roast chicken" is in rotation and uses chicken', () => {
      recipes = [recipe("Roast chicken", ["dinner"], "in-rotation"), recipe("baseline", ["dinner"], "in-rotation")];
      recipeIngredients = [
        {
          recipeId: makeRecipeId("Roast chicken"),
          ingredientId: chicken,
          quantity: makeQuantity(1, "piece"),
        },
      ];
    });

    When("1000 weeks are generated with different seeds", () => {
      const settings: Settings = {
        householdSize: 4,
        repeatExclusionWeeks: 0,
        slotLayout: [{ day: "monday", slots: ["dinner"] }],
      };
      roastCount = 0;
      baselineCount = 0;
      for (let seed = 0; seed < 1000; seed += 1) {
        const result = generateWeek({
          settings,
          weekStart: WEEK_START,
          recipes,
          recipeIngredients,
          pastPlanSlots: [],
          expiringIngredientIds: new Set([chicken]),
          rng: createFakeRng(seed),
        });
        const picked = placedRecipeIds(result.slots)[0];
        if (picked === "Roast chicken") roastCount += 1;
        if (picked === "baseline") baselineCount += 1;
      }
    });

    Then('"Roast chicken" is selected significantly more often than baseline', () => {
      expect(roastCount + baselineCount).toBe(1000);
      // Weight model: baseline=1, Roast chicken=1+EXPIRING_BOOST(5)=6, so the
      // expected split is ~6:1. Assert a much looser 3x bound so the
      // scenario stays robust to PRNG-quality noise while still proving the
      // boost dominates, not just nudges, the outcome.
      expect(roastCount).toBeGreaterThan(baselineCount * 3);
    });
  });

  Scenario("Retired recipes never appear", ({ Given, When, Then }) => {
    let recipes: Recipe[];
    let resultsAcrossSeeds: (string | undefined)[][];

    Given('"Liver stew" has status retired', () => {
      recipes = [recipe("Liver stew", ["dinner"], "retired"), recipe("other", ["dinner"], "in-rotation")];
    });

    When("a week is generated", () => {
      resultsAcrossSeeds = [];
      for (let seed = 0; seed < 20; seed += 1) {
        const result = generateWeek({
          settings: sevenDinnerSlotsSettings(),
          weekStart: WEEK_START,
          recipes,
          recipeIngredients: [],
          pastPlanSlots: [],
          expiringIngredientIds: new Set(),
          rng: createFakeRng(seed),
        });
        resultsAcrossSeeds.push(placedRecipeIds(result.slots));
      }
    });

    Then('"Liver stew" is not selected', () => {
      for (const ids of resultsAcrossSeeds) {
        expect(ids.includes("Liver stew")).toBe(false);
      }
    });
  });
});
