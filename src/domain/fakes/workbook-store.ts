/**
 * In-memory WorkbookStore fake. Holds typed entities directly (not cell
 * grids) — WP-12/13/14/17 want fast, typed fixtures for engine tests without
 * caring how a row round-trips through Sheets cells; that codec-layer
 * fidelity is what the SheetsTransport fake + WP-11's own codec tests cover.
 *
 * `inventoryEvents` is the only namespace without an upsert/replace method —
 * only `append` — matching invariant 1 (InventoryEvents rows are immutable)
 * at the fake's own API surface, not just by convention.
 */
import type { DecodeResult, WorkbookStore } from "../contracts.ts";
import type {
  Ingredient,
  IngredientId,
  InventoryEvent,
  Meta,
  PlanSlot,
  PlanSlotId,
  Recipe,
  RecipeId,
  RecipeIngredient,
  RecipeStep,
  Settings,
  ShoppingItem,
} from "../types.ts";

function ok<T>(rows: readonly T[]): DecodeResult<T> {
  return { rows, warnings: [] };
}

function shoppingItemKey(item: ShoppingItem): string {
  return `${item.ingredientId}|${item.rangeStart}|${item.rangeEnd}`;
}

const DEFAULT_META: Meta = { schemaVersion: 1, generation: 1 };
const DEFAULT_SETTINGS: Settings = {
  householdSize: 1,
  slotLayout: [],
  repeatExclusionWeeks: 3,
};

export function createFakeWorkbookStore(): WorkbookStore {
  let meta: Meta = DEFAULT_META;
  let settings: Settings = DEFAULT_SETTINGS;
  const ingredients = new Map<IngredientId, Ingredient>();
  const recipes = new Map<RecipeId, Recipe>();
  const recipeIngredients = new Map<RecipeId, readonly RecipeIngredient[]>();
  const recipeSteps = new Map<RecipeId, readonly RecipeStep[]>();
  const planSlots = new Map<PlanSlotId, PlanSlot>();
  const inventoryEvents: InventoryEvent[] = [];
  const shoppingItems = new Map<string, ShoppingItem>();

  return {
    meta: {
      async read() {
        return meta;
      },
      async write(next) {
        meta = next;
      },
    },
    settings: {
      async read() {
        return settings;
      },
      async write(next) {
        settings = next;
      },
    },
    ingredients: {
      async readAll() {
        return ok(Array.from(ingredients.values()));
      },
      async upsert(ingredient) {
        ingredients.set(ingredient.id, ingredient);
      },
    },
    recipes: {
      async readAll() {
        return ok(Array.from(recipes.values()));
      },
      async upsert(recipe) {
        recipes.set(recipe.id, recipe);
      },
    },
    recipeIngredients: {
      async readAll() {
        return ok(Array.from(recipeIngredients.values()).flat());
      },
      async replaceForRecipe(recipeId, lines) {
        recipeIngredients.set(recipeId, [...lines]);
      },
    },
    recipeSteps: {
      async readAll() {
        return ok(Array.from(recipeSteps.values()).flat());
      },
      async replaceForRecipe(recipeId, steps) {
        recipeSteps.set(recipeId, [...steps]);
      },
    },
    planSlots: {
      async readAll() {
        return ok(Array.from(planSlots.values()));
      },
      async upsert(slot) {
        planSlots.set(slot.id, slot);
      },
    },
    inventoryEvents: {
      async readFrom(cursor) {
        return {
          rows: inventoryEvents.slice(cursor),
          warnings: [],
          nextCursor: inventoryEvents.length,
        };
      },
      async append(event) {
        inventoryEvents.push(event);
      },
    },
    shoppingItems: {
      async readAll() {
        return ok(Array.from(shoppingItems.values()));
      },
      async upsert(item) {
        shoppingItems.set(shoppingItemKey(item), item);
      },
    },
  };
}
