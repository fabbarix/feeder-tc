import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { IngredientEditor } from "./IngredientEditor.tsx";
import { ToastProvider } from "../ui/components/Toast/ToastProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../domain/fakes/index.ts";
import { makeIngredientId, makeIsoDate, makeIsoTimestamp, type Ingredient } from "../domain/index.ts";

function renderEditor(contextValue: WorkbookContextValue, initialPath: string) {
  const router = createMemoryRouter(
    [
      { path: "/recipes/ingredients/new", element: <IngredientEditor /> },
      { path: "/recipes/ingredients/:ingredientId/edit", element: <IngredientEditor /> },
      { path: "/recipes/ingredients", element: <p>Ingredients list</p> },
    ],
    { initialEntries: [initialPath] },
  );
  return render(
    <WorkbookContext.Provider value={contextValue}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </WorkbookContext.Provider>,
  );
}

function baseIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: makeIngredientId("rolled-oats"),
    name: "Rolled oats",
    unit: "g",
    shelfLifeDays: 180,
    openedShelfLifeDays: 30,
    defaultLocation: "pantry",
    ...overrides,
  };
}

/**
 * WP-stale-save: `IngredientEditor.tsx`'s `ingredients.upsert` was one of
 * the "blind write" sites this workstream closes — a save here used to
 * clobber a concurrent household member's edit with no warning at all
 * (`src/domain/contracts.ts`'s documented-but-unimplemented "refresh-
 * before-edit is the caller's job"). This proves a stale save is now
 * caught, following the exact reference pattern `RecipeEditor.test.tsx`
 * exercises for the sibling editor.
 */
describe("IngredientEditor — stale-save protection", () => {
  it("warns instead of silently clobbering when the row changed since this editor loaded", async () => {
    const store = createFakeWorkbookStore();
    const ingredientId = makeIngredientId("rolled-oats");
    await store.ingredients.upsert(baseIngredient());

    const contextValue: WorkbookContextValue = {
      store,
      clock: createFixedClock(makeIsoTimestamp("2026-08-21T12:00:00.000Z"), makeIsoDate("2026-08-21")),
      rng: createFakeRng(1),
      workbookId: "wb-1",
      outbox: createFakeOutbox(),
    };

    renderEditor(contextValue, `/recipes/ingredients/${ingredientId}/edit`);
    await screen.findByDisplayValue("Rolled oats");

    // Another household member (or another tab) saves a change to this
    // exact row AFTER this editor loaded it.
    await store.ingredients.upsert(baseIngredient({ shelfLifeDays: 200 }));

    const user = userEvent.setup();
    const nameField = screen.getByLabelText("Name");
    await user.clear(nameField);
    await user.type(nameField, "Steel-cut oats");
    await user.click(screen.getByRole("button", { name: "Save ingredient" }));

    // Warned, not silently clobbered.
    const conflictDialog = await screen.findByRole("heading", { name: "This ingredient changed elsewhere" });
    expect(conflictDialog).toBeInTheDocument();

    // Nothing was written yet on this editor's behalf — the other client's
    // shelf-life change is still exactly what it saved.
    const midway = (await store.ingredients.readAll()).rows.find((i) => i.id === ingredientId);
    expect(midway?.shelfLifeDays).toBe(200);
    expect(midway?.name).toBe("Rolled oats");

    // "Keep editing" saves nothing.
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("heading", { name: "This ingredient changed elsewhere" })).not.toBeInTheDocument();
    const stillMidway = (await store.ingredients.readAll()).rows.find((i) => i.id === ingredientId);
    expect(stillMidway?.name).toBe("Rolled oats");

    // Explicitly choosing "Save anyway" lets the last write win, same LWW
    // contract as ever — but only once warned.
    await user.click(screen.getByRole("button", { name: "Save ingredient" }));
    await screen.findByRole("heading", { name: "This ingredient changed elsewhere" });
    await user.click(screen.getByRole("button", { name: "Save anyway" }));

    await waitFor(async () => {
      const saved = (await store.ingredients.readAll()).rows.find((i) => i.id === ingredientId);
      expect(saved?.name).toBe("Steel-cut oats");
    });
    // The concurrent shelf-life change (a field this save never touched)
    // is NOT protected once the user explicitly confirms an overwrite —
    // that is the documented LWW contract, unchanged.
  });

  it("saves without any conflict when nothing changed elsewhere", async () => {
    const store = createFakeWorkbookStore();
    const ingredientId = makeIngredientId("rolled-oats");
    await store.ingredients.upsert(baseIngredient());

    const contextValue: WorkbookContextValue = {
      store,
      clock: createFixedClock(makeIsoTimestamp("2026-08-21T12:00:00.000Z"), makeIsoDate("2026-08-21")),
      rng: createFakeRng(1),
      workbookId: "wb-1",
      outbox: createFakeOutbox(),
    };

    renderEditor(contextValue, `/recipes/ingredients/${ingredientId}/edit`);
    await screen.findByDisplayValue("Rolled oats");

    const user = userEvent.setup();
    const nameField = screen.getByLabelText("Name");
    await user.clear(nameField);
    await user.type(nameField, "Steel-cut oats");
    await user.click(screen.getByRole("button", { name: "Save ingredient" }));

    await screen.findByText("Ingredients list");
    expect(screen.queryByRole("heading", { name: "This ingredient changed elsewhere" })).not.toBeInTheDocument();
    const saved = (await store.ingredients.readAll()).rows.find((i) => i.id === ingredientId);
    expect(saved?.name).toBe("Steel-cut oats");
  });
});
