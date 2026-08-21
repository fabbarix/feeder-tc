import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { RecipeDetail } from "./RecipeDetail.tsx";
import { ToastProvider } from "../ui/components/Toast/ToastProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../domain/fakes/index.ts";
import { makeIsoDate, makeIsoTimestamp, makePlanSlotId, makeRecipeId, type PlanSlot, type Recipe } from "../domain/index.ts";

const TODAY = makeIsoDate("2026-08-21");

function renderDetail(contextValue: WorkbookContextValue, recipeId: string) {
  const router = createMemoryRouter(
    [
      { path: "/recipes/:recipeId", element: <RecipeDetail /> },
      { path: "/recipes/:recipeId/edit", element: <p>Edit recipe</p> },
      { path: "/recipes", element: <p>Recipes list</p> },
    ],
    { initialEntries: [`/recipes/${recipeId}`] },
  );
  return render(
    <WorkbookContext.Provider value={contextValue}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </WorkbookContext.Provider>,
  );
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: makeRecipeId("chili"),
    name: "Chili",
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 10,
    cookMinutes: 30,
    mealTags: ["dinner"],
    status: "in-rotation",
    ...overrides,
  };
}

function contextFor(store: ReturnType<typeof createFakeWorkbookStore>): WorkbookContextValue {
  return {
    store,
    clock: createFixedClock(makeIsoTimestamp("2026-08-21T18:00:00.000Z"), TODAY),
    rng: createFakeRng(1),
    workbookId: "wb-1",
    outbox: createFakeOutbox(),
  };
}

/**
 * WP-stale-save: RecipeDetail.tsx has two blind write sites this workstream
 * closes — the "Household flag" toggle (`recipes.upsert`) and "Mark cooked"
 * (`planSlots.upsert`). Both used to write from this route's own
 * once-loaded local copy; both now re-read fresh first.
 */
describe("RecipeDetail — stale-save protection", () => {
  it("the household flag doesn't revert a concurrent recipe edit to other fields", async () => {
    const store = createFakeWorkbookStore();
    const recipeId = makeRecipeId("chili");
    await store.recipes.upsert(recipe());

    renderDetail(contextFor(store), recipeId);
    await screen.findByRole("radio", { name: "Rotation" });

    // Another household member (e.g. via RecipeEditor) changes the cook
    // time on this exact recipe after this route loaded it.
    await store.recipes.upsert(recipe({ cookMinutes: 45 }));

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Staple" }));

    await waitFor(async () => {
      const saved = (await store.recipes.readAll()).rows.find((r) => r.id === recipeId);
      expect(saved?.status).toBe("staple");
    });
    const saved = (await store.recipes.readAll()).rows.find((r) => r.id === recipeId);
    expect(saved?.cookMinutes).toBe(45);
  });

  it("'Mark cooked' updates today's slot found on a FRESH read, not this route's stale local copy", async () => {
    const store = createFakeWorkbookStore();
    const recipeId = makeRecipeId("chili");
    await store.recipes.upsert(recipe());

    renderDetail(contextFor(store), recipeId);
    await screen.findByRole("button", { name: "Mark cooked" });

    // Another household member plans this exact recipe for today's dinner
    // AFTER this route's own load — this route's local `planSlots` has no
    // row for today at all.
    const plannedToday: PlanSlot = {
      id: makePlanSlotId("slot-today"),
      date: TODAY,
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "recipe", recipeId },
      state: "planned",
      pinned: true,
    };
    await store.planSlots.upsert(plannedToday);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mark cooked" }));

    await waitFor(async () => {
      const rows = (await store.planSlots.readAll()).rows;
      expect(rows).toHaveLength(1);
    });

    // Updates the ALREADY-PLANNED slot in place (state: cooked, pin kept) —
    // a stale local read (which saw no slot for today) would instead have
    // minted a brand new PlanSlot row, duplicating today's dinner.
    const rows = (await store.planSlots.readAll()).rows;
    expect(rows[0]?.id).toBe(plannedToday.id);
    expect(rows[0]?.state).toBe("cooked");
    expect(rows[0]?.pinned).toBe(true);
  });
});
