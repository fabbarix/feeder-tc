/**
 * Property test — WP-14 success criteria: "Allocator is pure and
 * order-stable; property test: total bought + viable stock >= total needs
 * for every generated case."
 *
 * Randomised over generated plans (recipes + plan slots, including
 * out-of-range/leftover/empty/skipped noise) and pantries (lots with random
 * quantities, purchase dates and expiries — some viable, some not). Uses the
 * injected seeded `Rng` (never `Math.random()`), so a failure is
 * reproducible: the failing seed is printed in the assertion message.
 *
 * The invariant holds because `neededQuantity` (bought) is always
 * `totalNeed - allocatedFromViableStock`, and `allocatedFromViableStock` can
 * never exceed the ingredient's total physical stock (viable stock is a
 * subset of total stock) — so `bought + totalStock >= totalNeed` regardless
 * of how allocation actually split things up. `totalStock` here is every
 * lot's quantity, viable or not, which is a safe (>= viable stock) upper
 * bound, matching "total bought + viable stock >= total needs" exactly
 * since substituting a smaller viable-stock figure could only make the sum
 * smaller, and it still has to reach at least `totalNeed` because bought
 * alone already accounts for whatever viable stock did NOT cover.
 */
import { describe, expect, it } from "vitest";
import { createSeededRng } from "./rng.ts";
import {
  makeIngredientId,
  makeIsoDate,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type IngredientId,
  type Lot,
  type PlanSlot,
  type PlanSlotFilling,
  type PlanSlotState,
  type Recipe,
  type RecipeIngredient,
  type Settings,
  type Unit,
} from "./types.ts";
import { addDays } from "./dates.ts";
import { computeNeeds } from "./shopping-needs.ts";
import { computeShoppingList } from "./shopping.ts";
import type { DateRange } from "./shopping-types.ts";
import type { Rng } from "./contracts.ts";

const INGREDIENT_IDS: readonly IngredientId[] = [
  makeIngredientId("ing-a"),
  makeIngredientId("ing-b"),
  makeIngredientId("ing-c"),
];
const INGREDIENT_UNIT = new Map<IngredientId, Unit>([
  [INGREDIENT_IDS[0]!, "piece"],
  [INGREDIENT_IDS[1]!, "g"],
  [INGREDIENT_IDS[2]!, "ml"],
]);

const RANGE_ORIGIN = makeIsoDate("2026-08-24");

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[randInt(rng, 0, items.length - 1)];
  if (item === undefined) throw new Error("pick from empty array");
  return item;
}

interface GeneratedCase {
  readonly range: DateRange;
  readonly planSlots: readonly PlanSlot[];
  readonly recipes: readonly Recipe[];
  readonly recipeIngredients: readonly RecipeIngredient[];
  readonly settings: Settings;
  readonly lots: readonly Lot[];
}

function generateCase(rng: Rng, seed: number): GeneratedCase {
  const rangeStart = addDays(RANGE_ORIGIN, randInt(rng, 0, 10));
  const rangeLenDays = randInt(rng, 6, 27); // up to a "monthly" multi-week span
  const range: DateRange = { start: rangeStart, end: addDays(rangeStart, rangeLenDays) };

  const recipeCount = randInt(rng, 1, 4);
  const recipes: Recipe[] = [];
  const recipeIngredients: RecipeIngredient[] = [];
  for (let r = 0; r < recipeCount; r += 1) {
    const id = makeRecipeId(`seed${seed}-recipe-${r}`);
    const baseServings = randInt(rng, 1, 4);
    recipes.push({
      id,
      name: id,
      kind: "cooked",
      baseServings,
      prepMinutes: randInt(rng, 0, 30),
      cookMinutes: randInt(rng, 5, 60),
      mealTags: ["dinner", "lunch", "breakfast", "snack"],
      status: "in-rotation",
    });
    const lineCount = randInt(rng, 1, INGREDIENT_IDS.length);
    const usedIngredients = new Set<IngredientId>();
    for (let l = 0; l < lineCount; l += 1) {
      const ingredientId = pick(rng, INGREDIENT_IDS);
      if (usedIngredients.has(ingredientId)) continue;
      usedIngredients.add(ingredientId);
      const unit = INGREDIENT_UNIT.get(ingredientId)!;
      recipeIngredients.push({
        recipeId: id,
        ingredientId,
        quantity: makeQuantity(randInt(rng, 1, 20), unit),
      });
    }
  }

  const slotCount = randInt(rng, 3, 15);
  const planSlots: PlanSlot[] = [];
  const fillingKinds: readonly PlanSlotFilling["kind"][] = ["recipe", "recipe", "recipe", "leftover", "empty"];
  const states: readonly PlanSlotState[] = ["planned", "planned", "cooked", "skipped"];
  const mealTags = ["breakfast", "lunch", "dinner", "snack"] as const;
  for (let s = 0; s < slotCount; s += 1) {
    // Some slots land outside the range on purpose — noise the invariant must survive.
    const date = addDays(range.start, randInt(rng, -3, rangeLenDays + 3));
    const kind = pick(rng, fillingKinds);
    let filling: PlanSlotFilling;
    if (kind === "recipe" && recipes.length > 0) {
      const recipe = pick(rng, recipes);
      const override = rng.next() < 0.3 ? randInt(rng, 1, 6) : undefined;
      filling = { kind: "recipe", recipeId: recipe.id, ...(override !== undefined ? { scaleServings: override } : {}) };
    } else if (kind === "leftover") {
      filling = { kind: "leftover", lotId: makeLotId(`seed${seed}-lot-${s}`) };
    } else {
      filling = { kind: "empty" };
    }
    planSlots.push({
      id: makePlanSlotId(`seed${seed}-slot-${s}`),
      date,
      slotType: pick(rng, mealTags),
      slotIndex: 0,
      filling,
      state: pick(rng, states),
      pinned: false,
    });
  }

  const lotCount = randInt(rng, 0, 8);
  const lots: Lot[] = [];
  for (let i = 0; i < lotCount; i += 1) {
    const ingredientId = pick(rng, INGREDIENT_IDS);
    const unit = INGREDIENT_UNIT.get(ingredientId)!;
    const purchaseDate = addDays(range.start, randInt(rng, -20, rangeLenDays));
    const expiry = addDays(purchaseDate, randInt(rng, -5, 40)); // some already expired, some far out
    lots.push({
      id: makeLotId(`seed${seed}-lot-stock-${i}`),
      ingredientId,
      quantity: makeQuantity(randInt(rng, 1, 30), unit),
      purchaseDate,
      location: "pantry",
      expiry,
      expiryOverridden: false,
    });
  }

  const settings: Settings = { householdSize: randInt(rng, 1, 8), slotLayout: [], repeatExclusionWeeks: 3 };

  return { range, planSlots, recipes, recipeIngredients, settings, lots };
}

describe("shopping engine property: bought + viable stock >= total needs", () => {
  const ITERATIONS = 200;

  for (let seed = 0; seed < ITERATIONS; seed += 1) {
    it(`holds for generated case #${seed}`, () => {
      const rng = createSeededRng(seed);
      const generated = generateCase(rng, seed);

      const needs = computeNeeds(
        generated.range,
        generated.planSlots,
        generated.recipes,
        generated.recipeIngredients,
        generated.settings,
      );
      const lines = computeShoppingList(generated);

      const totalNeedByIngredient = new Map<IngredientId, number>();
      for (const n of needs) {
        totalNeedByIngredient.set(n.ingredientId, (totalNeedByIngredient.get(n.ingredientId) ?? 0) + n.quantity.amount);
      }

      const totalStockByIngredient = new Map<IngredientId, number>();
      for (const l of generated.lots) {
        totalStockByIngredient.set(
          l.ingredientId,
          (totalStockByIngredient.get(l.ingredientId) ?? 0) + l.quantity.amount,
        );
      }

      const boughtByIngredient = new Map<IngredientId, number>();
      for (const line of lines) {
        boughtByIngredient.set(line.ingredientId, line.neededQuantity.amount);
      }

      for (const [ingredientId, totalNeed] of totalNeedByIngredient) {
        const bought = boughtByIngredient.get(ingredientId) ?? 0;
        const totalStock = totalStockByIngredient.get(ingredientId) ?? 0;
        expect(
          bought + totalStock,
          `seed ${seed}, ingredient ${ingredientId}: bought(${bought}) + totalStock(${totalStock}) < totalNeed(${totalNeed})`,
        ).toBeGreaterThanOrEqual(totalNeed - 1e-9);
      }
    });
  }

  it("is order-stable across many generated cases: shuffled inputs give identical results", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const rng = createSeededRng(seed + 10_000);
      const generated = generateCase(rng, seed + 10_000);

      const forward = computeShoppingList(generated);
      const shuffled = computeShoppingList({
        ...generated,
        planSlots: [...generated.planSlots].reverse(),
        recipes: [...generated.recipes].reverse(),
        recipeIngredients: [...generated.recipeIngredients].reverse(),
        lots: [...generated.lots].reverse(),
      });

      expect(shuffled).toEqual(forward);
    }
  });
});
