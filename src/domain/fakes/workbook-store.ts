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
import {
  MAX_PHOTO_DATA_URL_LENGTH,
  type Barcode,
  type Ingredient,
  type IngredientId,
  type InventoryEvent,
  type Meta,
  type Photo,
  type PhotoOwnerId,
  type PhotoOwnerKind,
  type PlanSlot,
  type PlanSlotId,
  type PriceObservation,
  type PriceObservationId,
  type Product,
  type Recipe,
  type RecipeId,
  type RecipeIngredient,
  type RecipeStep,
  type Settings,
  type ShoppingItem,
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
  currency: "$",
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
  const products = new Map<Barcode, Product>();
  const photos = new Map<string, Photo>();
  const priceObservations = new Map<PriceObservationId, PriceObservation>();

  function photoKey(ownerKind: PhotoOwnerKind, ownerId: PhotoOwnerId): string {
    return `${ownerKind}|${ownerId}`;
  }

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
    products: {
      async readAll() {
        return ok(Array.from(products.values()));
      },
      async upsert(product) {
        products.set(product.barcode, product);
      },
    },
    photos: {
      // Deliberately no `readAll` here — see WorkbookStore.photos's own doc
      // comment in contracts.ts for why one must never be added.
      async get(ownerKind, ownerId) {
        return photos.get(photoKey(ownerKind, ownerId));
      },
      async upsert(photo) {
        // Mirrors the 50,000-character Sheets cell ceiling the real,
        // Sheets-backed codec enforces (src/sheets/codecs/photos.ts) — a
        // package developing against this fake must see the same refusal
        // the real backend would give, not a false pass.
        if (photo.dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
          throw new Error(
            `Photo data URL is ${photo.dataUrl.length} characters, over the ${MAX_PHOTO_DATA_URL_LENGTH}-character Google Sheets cell limit (DESIGN_PHOTOS.md §4). Refusing to write — re-encode at a smaller byte budget rather than truncating.`,
          );
        }
        photos.set(photoKey(photo.ownerKind, photo.ownerId), photo);
      },
      async remove(ownerKind, ownerId) {
        photos.delete(photoKey(ownerKind, ownerId));
      },
    },
    priceObservations: {
      async readAll() {
        return ok(Array.from(priceObservations.values()));
      },
      async append(observation) {
        priceObservations.set(observation.id, observation);
      },
    },
  };
}
