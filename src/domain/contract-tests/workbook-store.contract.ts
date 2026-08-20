/**
 * Shared WorkbookStore behavioural contract. WP-11 re-runs this exact suite
 * against its real Sheets-backed implementation.
 */
import { describe, expect, it } from "vitest";
import type { WorkbookStore } from "../contracts.ts";
import {
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type Ingredient,
  type InventoryEvent,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type RecipeStep,
  type Settings,
  type ShoppingItem,
} from "../types.ts";

const RICE = makeIngredientId("rice");
const CHILI = makeRecipeId("chili");
const SLOT_1 = makePlanSlotId("slot-1");

function riceIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: RICE,
    name: "Rice",
    unit: "g",
    shelfLifeDays: 730,
    openedShelfLifeDays: 365,
    defaultLocation: "pantry",
    ...overrides,
  };
}

function chiliRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: CHILI,
    name: "Chili",
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 15,
    cookMinutes: 45,
    mealTags: ["dinner"],
    status: "in-rotation",
    ...overrides,
  };
}

function chiliRiceLine(): RecipeIngredient {
  return { recipeId: CHILI, ingredientId: RICE, quantity: makeQuantity(200, "g") };
}

function chiliStep(): RecipeStep {
  return { recipeId: CHILI, stepNumber: 1, text: "Simmer for 45 minutes." };
}

function tuesdaySlot(overrides: Partial<PlanSlot> = {}): PlanSlot {
  return {
    id: SLOT_1,
    date: makeIsoDate("2026-03-03"),
    slotType: "dinner",
    slotIndex: 0,
    filling: { kind: "recipe", recipeId: CHILI },
    state: "planned",
    pinned: false,
    ...overrides,
  };
}

function purchaseEvent(id: string, isoTimestamp: string): InventoryEvent {
  return {
    type: "purchase",
    id: makeEventId(id),
    timestamp: makeIsoTimestamp(isoTimestamp),
    ingredientId: RICE,
    lotId: makeLotId(`${id}-lot`),
    quantity: makeQuantity(1000, "g"),
    location: "pantry",
    purchaseDate: makeIsoDate("2026-03-01"),
  };
}

function useEvent(id: string, isoTimestamp: string, amount: number): InventoryEvent {
  return {
    type: "use",
    id: makeEventId(id),
    timestamp: makeIsoTimestamp(isoTimestamp),
    ingredientId: RICE,
    quantity: makeQuantity(amount, "g"),
  };
}

function shoppingRice(): ShoppingItem {
  return {
    ingredientId: RICE,
    rangeStart: makeIsoDate("2026-03-01"),
    rangeEnd: makeIsoDate("2026-03-07"),
    neededQuantity: makeQuantity(400, "g"),
    checked: false,
  };
}

const SETTINGS: Settings = {
  householdSize: 4,
  slotLayout: [{ day: "monday", slots: ["dinner"] }],
  repeatExclusionWeeks: 3,
};

export function describeWorkbookStoreContract(makeSubject: () => WorkbookStore): void {
  describe("WorkbookStore contract", () => {
    it("meta: write then read round-trips", async () => {
      const store = makeSubject();
      await store.meta.write({ schemaVersion: 1, generation: 2 });
      expect(await store.meta.read()).toEqual({ schemaVersion: 1, generation: 2 });
    });

    it("settings: write then read round-trips", async () => {
      const store = makeSubject();
      await store.settings.write(SETTINGS);
      expect(await store.settings.read()).toEqual(SETTINGS);
    });

    it("ingredients: upsert then readAll returns it, upsert with the same id replaces rather than duplicates", async () => {
      const store = makeSubject();
      await store.ingredients.upsert(riceIngredient());
      await store.ingredients.upsert(riceIngredient({ shelfLifeDays: 900 }));
      const { rows, warnings } = await store.ingredients.readAll();
      expect(rows).toEqual([riceIngredient({ shelfLifeDays: 900 })]);
      expect(warnings).toEqual([]);
    });

    it("recipes: upsert then readAll", async () => {
      const store = makeSubject();
      await store.recipes.upsert(chiliRecipe());
      const { rows } = await store.recipes.readAll();
      expect(rows).toEqual([chiliRecipe()]);
    });

    it("recipeIngredients: replaceForRecipe replaces the full set for that recipe", async () => {
      const store = makeSubject();
      await store.recipeIngredients.replaceForRecipe(CHILI, [chiliRiceLine()]);
      await store.recipeIngredients.replaceForRecipe(CHILI, []);
      const { rows } = await store.recipeIngredients.readAll();
      expect(rows).toEqual([]);
    });

    it("recipeSteps: replaceForRecipe then readAll", async () => {
      const store = makeSubject();
      await store.recipeSteps.replaceForRecipe(CHILI, [chiliStep()]);
      const { rows } = await store.recipeSteps.readAll();
      expect(rows).toEqual([chiliStep()]);
    });

    it("planSlots: upsert then readAll", async () => {
      const store = makeSubject();
      await store.planSlots.upsert(tuesdaySlot());
      const { rows } = await store.planSlots.readAll();
      expect(rows).toEqual([tuesdaySlot()]);
    });

    it("inventoryEvents: append is the only write, readFrom(0) returns everything appended in order", async () => {
      const store = makeSubject();
      const event = purchaseEvent("evt-1", "2026-03-01T09:00:00Z");
      await store.inventoryEvents.append(event);
      const page = await store.inventoryEvents.readFrom(0);
      expect(page.rows).toEqual([event]);
      expect(page.nextCursor).toBe(1);
      expect(page.warnings).toEqual([]);
    });

    it("inventoryEvents: readFrom(cursor) returns only rows at/after the cursor", async () => {
      const store = makeSubject();
      const first = useEvent("evt-1", "2026-03-01T09:00:00Z", 100);
      const second = useEvent("evt-2", "2026-03-02T09:00:00Z", 50);
      await store.inventoryEvents.append(first);
      await store.inventoryEvents.append(second);
      const page = await store.inventoryEvents.readFrom(1);
      expect(page.rows).toEqual([second]);
      expect(page.nextCursor).toBe(2);
    });

    it("shoppingItems: upsert then readAll", async () => {
      const store = makeSubject();
      await store.shoppingItems.upsert(shoppingRice());
      const { rows } = await store.shoppingItems.readAll();
      expect(rows).toEqual([shoppingRice()]);
    });
  });
}
