import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ToastProvider } from "../../ui/components/Toast/ToastProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../../domain/fakes/index.ts";
import { __resetSharedOutboxSyncRegistryForTests } from "../../sync/index.ts";
import {
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type DateRange,
  type Ingredient,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type Settings,
  type WorkbookStore,
} from "../../domain/index.ts";
import { useShoppingList } from "./useShoppingList.ts";

const TOMATO = makeIngredientId("tomato");
const RECIPE_ID = makeRecipeId("tomato-pasta");
const MONDAY = makeIsoDate("2026-08-17");
const RANGE: DateRange = { start: MONDAY, end: makeIsoDate("2026-08-23") };

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
    id: makePlanSlotId("slot-monday-dinner"),
    date: MONDAY,
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
    clock: createFixedClock(makeIsoTimestamp("2026-08-17T18:00:00.000Z"), MONDAY),
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

/**
 * WP-stale-save: `useShoppingList.ts`'s check-off/override writes
 * (`shoppingItems.upsert`) are the one site this workstream deliberately
 * does NOT put a live re-read in front of — UI_DESIGN.md §1 invariant 5
 * ("the shopping list is used one-handed, in a supermarket aisle, on a bad
 * connection"). Protection here instead comes from merging onto the
 * ALREADY-SYNCED local snapshot (`shoppingItems` state) rather than a
 * captured stale copy — this proves both halves: the merge protects a
 * concurrently-set `purchaseOverride`, AND check-off genuinely never blocks
 * on a fresh network read.
 */
describe("useShoppingList — check-off protects other fields without a blocking round trip", () => {
  // The shared, app-wide Outbox/SnapshotStore this hook acquires
  // (outbox-registry.ts) key on `workbookId` and persist to real
  // `localStorage` — both module-level singletons that survive across
  // tests in this file (same reset this repo's own
  // `outbox-registry.test.ts` does).
  beforeEach(() => {
    window.localStorage.clear();
    __resetSharedOutboxSyncRegistryForTests();
  });
  afterEach(() => {
    __resetSharedOutboxSyncRegistryForTests();
  });

  it("preserves a purchaseOverride already known locally when checking a line off", async () => {
    const store = createFakeWorkbookStore();
    await seed(store);
    // A purchaseOverride already synced from an earlier read (e.g. another
    // household member set "I want 5, not 2" before this session started).
    await store.shoppingItems.upsert({
      ingredientId: TOMATO,
      rangeStart: RANGE.start,
      rangeEnd: RANGE.end,
      neededQuantity: makeQuantity(2, "piece"),
      checked: false,
      purchaseOverride: makeQuantity(5, "piece"),
    });

    const { result } = renderHook(() => useShoppingList(RANGE), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const line = result.current.lines.find((l) => l.ingredientId === TOMATO);
    expect(line).toBeDefined();
    expect(line?.purchaseOverride).toEqual(makeQuantity(5, "piece"));

    await result.current.checkOff(line!, { location: "pantry" });

    const saved = (await store.shoppingItems.readAll()).rows.find((i) => i.ingredientId === TOMATO);
    expect(saved?.checked).toBe(true);
    // The override is a field this check-off never intended to touch — it
    // must survive, not be reset by whatever this session's write happened
    // to carry.
    expect(saved?.purchaseOverride).toEqual(makeQuantity(5, "piece"));
  });

  it("never awaits a fresh shoppingItems read — check-off completes even while one hangs forever", async () => {
    const store = createFakeWorkbookStore();
    await seed(store);

    const { result } = renderHook(() => useShoppingList(RANGE), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const line = result.current.lines.find((l) => l.ingredientId === TOMATO);
    expect(line).toBeDefined();

    // Simulate a very bad connection: from this point on, any FRESH read of
    // ShoppingItems hangs forever. If check-off's write path secretly
    // awaited one (the "blocking round trip" this workstream must not add
    // to this exact path), this test would time out.
    (store as { shoppingItems: { readAll: () => Promise<never> } }).shoppingItems.readAll = () => new Promise(() => {});

    await result.current.checkOff(line!, { location: "pantry" });
    // Reaching here at all is the assertion — `checkOff`'s own promise
    // resolved without depending on the now-hung readAll.
    expect(true).toBe(true);
  });
});
