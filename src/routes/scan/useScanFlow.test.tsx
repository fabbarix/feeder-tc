import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ToastProvider } from "../../ui/components/Toast/ToastProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../../domain/fakes/index.ts";
import { __resetSharedOutboxSyncRegistryForTests } from "../../sync/index.ts";
import {
  makeBarcode,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type DateRange,
  type Ingredient,
  type PlanSlot,
  type Product,
  type Recipe,
  type RecipeIngredient,
  type Settings,
  type WorkbookStore,
} from "../../domain/index.ts";
import { useScanFlow } from "./useScanFlow.ts";

const TOMATO = makeIngredientId("tomato");
const RECIPE_ID = makeRecipeId("tomato-pasta");
const TODAY = makeIsoDate("2026-08-17");
const RANGE: DateRange = { start: TODAY, end: makeIsoDate("2026-08-23") };

const SETTINGS: Settings = { householdSize: 4, slotLayout: [], repeatExclusionWeeks: 3, currency: "$" };

const INGREDIENTS: readonly Ingredient[] = [
  { id: TOMATO, name: "Tomato", unit: "piece", shelfLifeDays: 10, openedShelfLifeDays: 5, defaultLocation: "pantry" },
];

const RECIPES: readonly Recipe[] = [
  {
    id: RECIPE_ID,
    name: "Tomato pasta",
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    mealTags: ["dinner"],
    status: "in-rotation",
  },
];

const RECIPE_INGREDIENTS: readonly RecipeIngredient[] = [
  { recipeId: RECIPE_ID, ingredientId: TOMATO, quantity: makeQuantity(2, "piece") },
];

const PLAN_SLOTS: readonly PlanSlot[] = [
  {
    id: makePlanSlotId("slot-today-dinner"),
    date: TODAY,
    slotType: "dinner",
    slotIndex: 0,
    filling: { kind: "recipe", recipeId: RECIPE_ID },
    state: "planned",
    pinned: false,
  },
];

async function seed(store: WorkbookStore): Promise<void> {
  await store.settings.write(SETTINGS);
  for (const ingredient of INGREDIENTS) await store.ingredients.upsert(ingredient);
  for (const recipe of RECIPES) await store.recipes.upsert(recipe);
  await store.recipeIngredients.replaceForRecipe(RECIPE_ID, RECIPE_INGREDIENTS);
  for (const slot of PLAN_SLOTS) await store.planSlots.upsert(slot);
}

function wrapperFor(store: WorkbookStore): ({ children }: { readonly children: ReactNode }) => JSX.Element {
  const contextValue: WorkbookContextValue = {
    store,
    clock: createFixedClock(makeIsoTimestamp("2026-08-17T18:00:00.000Z"), TODAY),
    rng: createFakeRng(1),
    workbookId: "wb-1",
    outbox: createFakeOutbox(),
  };
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <WorkbookContext.Provider value={contextValue}>
        <ToastProvider>{children}</ToastProvider>
      </WorkbookContext.Provider>
    );
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    barcode: makeBarcode("8001120000123"),
    name: "Big Jar Mayo",
    ingredientId: TOMATO,
    canonicalQuantity: makeQuantity(500, "g"),
    displayQuantity: 500,
    displayUnit: "g",
    shelfLifeDays: 90,
    isBulk: false,
    hasPhoto: false,
    ...overrides,
  };
}

describe("useScanFlow — stale-save protection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetSharedOutboxSyncRegistryForTests();
  });
  afterEach(() => {
    __resetSharedOutboxSyncRegistryForTests();
  });

  /**
   * WP-stale-save: `recordPurchase`'s `shoppingItems.upsert` used to write
   * straight from the engine-computed `need` alone, which never carries a
   * `purchaseOverride` and silently erased whatever the household had
   * already persisted on that ShoppingItems row. Now merges onto this
   * hook's own already-synced local snapshot.
   */
  it("recording a purchase from a scan preserves an already-persisted purchaseOverride", async () => {
    const store = createFakeWorkbookStore();
    await seed(store);
    await store.shoppingItems.upsert({
      ingredientId: TOMATO,
      rangeStart: RANGE.start,
      rangeEnd: RANGE.end,
      neededQuantity: makeQuantity(2, "piece"),
      checked: false,
      purchaseOverride: makeQuantity(6, "piece"),
    });

    const { result } = renderHook(() => useScanFlow(), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.shoppingNeedByIngredient.get(TOMATO)).toBeDefined();

    await result.current.recordPurchase({
      ingredientId: TOMATO,
      buyQuantity: makeQuantity(6, "piece"),
      location: "pantry",
      purchaseDate: TODAY,
    });

    const saved = (await store.shoppingItems.readAll()).rows.find((i) => i.ingredientId === TOMATO);
    expect(saved?.checked).toBe(true);
    expect(saved?.boughtQuantity).toEqual(makeQuantity(6, "piece"));
    // The household's own explicit buy-amount choice, set before this scan
    // and never touched by it, survives.
    expect(saved?.purchaseOverride).toEqual(makeQuantity(6, "piece"));
  });

  /**
   * WP-stale-save: `saveProduct` only ever runs for a barcode this device
   * believed was unrecognised — two devices scanning the SAME unknown
   * barcode around the same time would otherwise let whichever save
   * lands last silently overwrite the other's product definition
   * (`products.upsert` is insert-or-replace by barcode). This proves the
   * create-path guard: a barcode that already exists by save time is
   * reported as a conflict instead of overwritten.
   */
  it("does not overwrite a product another client already created for the same barcode", async () => {
    const store = createFakeWorkbookStore();
    await seed(store);

    const { result } = renderHook(() => useScanFlow(), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // This device scanned the barcode as unrecognised — nothing in its own
    // `productsByBarcode` yet. Another client saves a DIFFERENT product
    // definition for that exact barcode in the meantime.
    const theirs = product({ name: "Small Jar Mayo", canonicalQuantity: makeQuantity(250, "g") });
    await store.products.upsert(theirs);

    const mine = product({ name: "Big Jar Mayo (mine)" });
    const outcome = await result.current.saveProduct(mine);

    expect(outcome).toEqual({ status: "conflict", existing: theirs });
    const saved = (await store.products.readAll()).rows.find((p) => p.barcode === theirs.barcode);
    // Still theirs — not silently overwritten by this device's definition.
    expect(saved?.name).toBe("Small Jar Mayo");
  });

  it("creates the product normally when the barcode genuinely is new", async () => {
    const store = createFakeWorkbookStore();
    await seed(store);

    const { result } = renderHook(() => useScanFlow(), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const mine = product();
    const outcome = await result.current.saveProduct(mine);

    expect(outcome).toEqual({ status: "created" });
    const saved = (await store.products.readAll()).rows.find((p) => p.barcode === mine.barcode);
    expect(saved?.name).toBe("Big Jar Mayo");
  });
});
