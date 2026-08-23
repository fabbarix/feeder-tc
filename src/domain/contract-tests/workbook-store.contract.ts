/**
 * Shared WorkbookStore behavioural contract. WP-11 re-runs this exact suite
 * against its real Sheets-backed implementation.
 */
import { describe, expect, it } from "vitest";
import type { WorkbookStore } from "../contracts.ts";
import {
  makeBarcode,
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makePlanSlotId,
  makePriceObservationId,
  makeProductId,
  makeQuantity,
  makeRecipeId,
  makeStepId,
  type Ingredient,
  type InventoryEvent,
  type Photo,
  type PlanSlot,
  type PriceObservation,
  type Product,
  type ProductBarcode,
  type Recipe,
  type RecipeIngredient,
  type RecipeStep,
  type Settings,
  type ShoppingItem,
} from "../types.ts";

const RICE = makeIngredientId("rice");
const CHILI = makeRecipeId("chili");
const CHILI_STEP_1 = makeStepId("chili-step-1");
const SLOT_1 = makePlanSlotId("slot-1");
const RICE_BAG_BARCODE = makeBarcode("8001120000123");
const RICE_BAG_ID = makeProductId("rice-bag-1");

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
  return { recipeId: CHILI, id: CHILI_STEP_1, stepNumber: 1, description: "Simmer for 45 minutes." };
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

function riceBagProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: RICE_BAG_ID,
    name: "Riso Gallo Arborio",
    brand: "Riso Gallo",
    ingredientId: RICE,
    canonicalQuantity: makeQuantity(1000, "g"),
    displayQuantity: 1,
    displayUnit: "kg",
    shelfLifeDays: 730,
    isBulk: false,
    hasPhoto: false,
    ...overrides,
  };
}

function riceBagPhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    ownerKind: "product",
    ownerId: RICE_BAG_ID,
    dataUrl: "data:image/webp;base64,dGVzdC1waG90by1ieXRlcw==",
    updatedAt: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    ...overrides,
  };
}

function riceBagBarcodeRow(overrides: Partial<ProductBarcode> = {}): ProductBarcode {
  return {
    productId: RICE_BAG_ID,
    barcode: RICE_BAG_BARCODE,
    ...overrides,
  };
}

function ricePriceObservation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    id: makePriceObservationId("obs-1"),
    timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    barcode: RICE_BAG_BARCODE,
    ingredientId: RICE,
    quantity: makeQuantity(1000, "g"),
    price: 2.5,
    source: "Corner store",
    ...overrides,
  };
}

const SETTINGS: Settings = {
  householdSize: 4,
  slotLayout: [{ day: "monday", slots: ["dinner"] }],
  repeatExclusionWeeks: 3,
  // M6-A: exercised explicitly here (rather than left absent) because
  // decodeSettings always returns a concrete currency, defaulting a blank
  // cell to "$" — see settings.ts. Leaving it out would make this
  // round-trip assertion fail not because anything is broken, but because
  // read() legitimately fills in a default the fixture didn't ask for.
  currency: "£",
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

    it("products: upsert then readAll returns it, upsert with the same id replaces rather than duplicates", async () => {
      const store = makeSubject();
      await store.products.upsert(riceBagProduct());
      await store.products.upsert(riceBagProduct({ hasPhoto: true }));
      const { rows, warnings } = await store.products.readAll();
      expect(rows).toEqual([riceBagProduct({ hasPhoto: true })]);
      expect(warnings).toEqual([]);
    });

    // WP-PRODUCTS-MODEL: one row per barcode a product owns.
    it("productBarcodes: upsert then readAll returns it, upsert with the same barcode replaces rather than duplicates", async () => {
      const store = makeSubject();
      await store.productBarcodes.upsert(riceBagBarcodeRow());
      const otherProduct = makeProductId("other-product");
      await store.productBarcodes.upsert(riceBagBarcodeRow({ productId: otherProduct }));
      const { rows, warnings } = await store.productBarcodes.readAll();
      expect(rows).toEqual([riceBagBarcodeRow({ productId: otherProduct })]);
      expect(warnings).toEqual([]);
    });

    it("productBarcodes: a product can own several barcodes as separate rows (invariant 6 — never a delimited list)", async () => {
      const store = makeSubject();
      const secondBarcode = makeBarcode("8001120000456");
      await store.productBarcodes.upsert(riceBagBarcodeRow());
      await store.productBarcodes.upsert(riceBagBarcodeRow({ barcode: secondBarcode }));
      const { rows } = await store.productBarcodes.readAll();
      expect(rows).toEqual([riceBagBarcodeRow(), riceBagBarcodeRow({ barcode: secondBarcode })]);
    });

    it("photos: get(ownerKind, ownerId) is undefined before any upsert, and returns the photo after", async () => {
      const store = makeSubject();
      expect(await store.photos.get("product", RICE_BAG_ID)).toBeUndefined();
      await store.photos.upsert(riceBagPhoto());
      expect(await store.photos.get("product", RICE_BAG_ID)).toEqual(riceBagPhoto());
    });

    it("photos: upsert with the same (ownerKind, ownerId) replaces rather than duplicates", async () => {
      const store = makeSubject();
      await store.photos.upsert(riceBagPhoto());
      await store.photos.upsert(riceBagPhoto({ dataUrl: "data:image/webp;base64,dXBkYXRlZA==" }));
      expect(await store.photos.get("product", RICE_BAG_ID)).toEqual(
        riceBagPhoto({ dataUrl: "data:image/webp;base64,dXBkYXRlZA==" }),
      );
    });

    it("photos: different owner kinds sharing the same raw id string are distinct rows (the key is the PAIR, not just ownerId)", async () => {
      const store = makeSubject();
      const sharedRawId = "shared-8001120000123-ish";
      await store.photos.upsert({
        ownerKind: "ingredient",
        ownerId: makeIngredientId(sharedRawId),
        dataUrl: "data:image/webp;base64,aW5ncmVkaWVudA==",
        updatedAt: makeIsoTimestamp("2026-03-01T09:00:00Z"),
      });
      await store.photos.upsert({
        ownerKind: "recipe",
        ownerId: makeRecipeId(sharedRawId),
        dataUrl: "data:image/webp;base64,cmVjaXBl",
        updatedAt: makeIsoTimestamp("2026-03-02T09:00:00Z"),
      });
      expect((await store.photos.get("ingredient", makeIngredientId(sharedRawId)))?.dataUrl).toBe(
        "data:image/webp;base64,aW5ncmVkaWVudA==",
      );
      expect((await store.photos.get("recipe", makeRecipeId(sharedRawId)))?.dataUrl).toBe(
        "data:image/webp;base64,cmVjaXBl",
      );
    });

    it("photos: remove deletes the row; removing a never-written key is a no-op", async () => {
      const store = makeSubject();
      await store.photos.upsert(riceBagPhoto());
      await store.photos.remove("product", RICE_BAG_ID);
      expect(await store.photos.get("product", RICE_BAG_ID)).toBeUndefined();
      await expect(store.photos.remove("product", RICE_BAG_ID)).resolves.toBeUndefined();
    });

    it("photos: upsert refuses a data URL over the 50,000-character Sheets cell limit rather than truncating it", async () => {
      const store = makeSubject();
      const oversized: Photo = {
        ownerKind: "product",
        ownerId: RICE_BAG_ID,
        dataUrl: "A".repeat(50_001),
        updatedAt: makeIsoTimestamp("2026-03-01T09:00:00Z"),
      };
      await expect(store.photos.upsert(oversized)).rejects.toThrow(/50,000-character|Google Sheets cell limit/);
      // Nothing was written — not even a truncated row.
      expect(await store.photos.get("product", RICE_BAG_ID)).toBeUndefined();
    });

    it("priceObservations: append is the only write, readAll returns everything appended", async () => {
      const store = makeSubject();
      const first = ricePriceObservation();
      const second = ricePriceObservation({ id: makePriceObservationId("obs-2"), price: 2.75 });
      await store.priceObservations.append(first);
      await store.priceObservations.append(second);
      const { rows, warnings } = await store.priceObservations.readAll();
      expect(rows).toEqual([first, second]);
      expect(warnings).toEqual([]);
    });
  });
}
