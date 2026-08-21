import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { RecipeEditor } from "./RecipeEditor.tsx";
import { ToastProvider } from "../ui/components/Toast/ToastProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../domain/fakes/index.ts";
import { makeIsoDate, makeIsoTimestamp, makeRecipeId, makeStepId, type Recipe, type RecipeStep } from "../domain/index.ts";

function renderEditor(contextValue: WorkbookContextValue, initialPath: string) {
  const router = createMemoryRouter(
    [
      { path: "/recipes/new", element: <RecipeEditor /> },
      { path: "/recipes/:recipeId/edit", element: <RecipeEditor /> },
      { path: "/recipes", element: <p>Recipes list</p> },
      { path: "/recipes/:recipeId", element: <p>Recipe detail</p> },
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

/**
 * Regression test for the round-trip data-loss bug fixed alongside WP-PHOTO's
 * UI (see RecipeEditor.tsx's `StepDraft` doc comment): before this fix, the
 * editor's load path only ever read a step's `description` into state, and
 * its save path only ever wrote back `{recipeId, id, stepNumber,
 * description}` — so opening any existing recipe and saving with NO edits at
 * all silently erased every step's `detail`, `durationMinutes` and
 * `hasPhoto`. This loads a step carrying all three, saves untouched, and
 * asserts every field survives byte-for-byte.
 */
describe("RecipeEditor — step round-trip (WP-PHOTO regression)", () => {
  it("preserves detail, durationMinutes, hasPhoto and id through an untouched load/save cycle", async () => {
    const store = createFakeWorkbookStore();
    const recipeId = makeRecipeId("chili");
    const stepId = makeStepId("step-1");
    const recipe: Recipe = {
      id: recipeId,
      name: "Chili",
      kind: "cooked",
      baseServings: 4,
      prepMinutes: 10,
      cookMinutes: 30,
      mealTags: ["dinner"],
      status: "in-rotation",
    };
    const step: RecipeStep = {
      recipeId,
      id: stepId,
      stepNumber: 1,
      description: "Simmer until thick.",
      detail: "Stir every 5 minutes so it doesn't catch on the bottom of the pan.",
      durationMinutes: 20,
      hasPhoto: true,
    };
    await store.recipes.upsert(recipe);
    await store.recipeSteps.replaceForRecipe(recipeId, [step]);
    // A real photo backs this step's `hasPhoto: true` — an untouched
    // load/save must not orphan it (the row keeps claiming a photo exists,
    // and one still does).
    await store.photos.upsert({
      ownerKind: "recipe-step",
      ownerId: stepId,
      dataUrl: "data:image/webp;base64,AAAA",
      updatedAt: makeIsoTimestamp("2026-08-21T00:00:00.000Z"),
    });

    const contextValue: WorkbookContextValue = {
      store,
      clock: createFixedClock(makeIsoTimestamp("2026-08-21T12:00:00.000Z"), makeIsoDate("2026-08-21")),
      rng: createFakeRng(1),
      workbookId: "wb-1",
      outbox: createFakeOutbox(),
    };

    renderEditor(contextValue, `/recipes/${recipeId}/edit`);

    await screen.findByRole("heading", { name: "Edit recipe" });
    // Sanity check: the loaded step's instruction line is what we expect
    // before touching anything — proves this is testing a genuine load, not
    // an editor that never populated its fields in the first place.
    expect(await screen.findByDisplayValue(step.description)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save recipe" }));

    await waitFor(async () => {
      const saved = await store.recipeSteps.readAll();
      expect(saved.rows).toHaveLength(1);
    });

    const saved = await store.recipeSteps.readAll();
    const savedStep = saved.rows[0]!;
    expect(savedStep.id).toBe(stepId);
    expect(savedStep.description).toBe(step.description);
    expect(savedStep.detail).toBe(step.detail);
    expect(savedStep.durationMinutes).toBe(step.durationMinutes);
    expect(savedStep.hasPhoto).toBe(true);

    // The backing photo itself must still be there too — a round-trip that
    // preserved the `hasPhoto` flag but dropped the actual `Photos` row
    // would be a different, quieter flavour of the same bug.
    const photo = await store.photos.get("recipe-step", stepId);
    expect(photo?.dataUrl).toBe("data:image/webp;base64,AAAA");
  });
});
