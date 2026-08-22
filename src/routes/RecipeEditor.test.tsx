import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { RecipeEditor } from "./RecipeEditor.tsx";
import { ToastProvider } from "../ui/components/Toast/ToastProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../domain/fakes/index.ts";
import {
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeRecipeId,
  makeStepId,
  type Ingredient,
  type Recipe,
  type RecipeStep,
} from "../domain/index.ts";

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

function contextValue(store: ReturnType<typeof createFakeWorkbookStore>): WorkbookContextValue {
  return {
    store,
    clock: createFixedClock(makeIsoTimestamp("2026-08-21T12:00:00.000Z"), makeIsoDate("2026-08-21")),
    rng: createFakeRng(1),
    workbookId: "wb-1",
    outbox: createFakeOutbox(),
  };
}

/** DESIGN_PURCHASING.md §4/§8 — pre-checked for Bought, and stays following Kind until the household explicitly overrides it. */
describe("RecipeEditor — Can't be split (DESIGN_PURCHASING.md §4/§8)", () => {
  it("defaults to unchecked for a new Cooked recipe and checked for Bought", async () => {
    const store = createFakeWorkbookStore();
    renderEditor(contextValue(store), "/recipes/new");
    await screen.findByLabelText("Name");

    expect(screen.getByRole("radio", { name: "Splits into portions" })).toBeChecked();

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Store-bought" }));
    expect(screen.getByRole("radio", { name: "Can't be split" })).toBeChecked();

    // Flipping Kind back keeps following it — the household never touched
    // "Can't be split" itself.
    await user.click(screen.getByRole("radio", { name: "Cooked" }));
    expect(screen.getByRole("radio", { name: "Splits into portions" })).toBeChecked();
  });

  it("saves indivisible explicitly once the household overrides it, and omits it when left following Kind", async () => {
    const store = createFakeWorkbookStore();
    const user = userEvent.setup();

    // Untouched Bought recipe — the default matches kind, so `indivisible`
    // stays implicit (never written) rather than freezing today's default.
    renderEditor(contextValue(store), "/recipes/new");
    await user.type(await screen.findByLabelText("Name"), "Frozen pizza");
    await user.click(screen.getByRole("radio", { name: "Store-bought" }));
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    await screen.findByText("Recipes list");

    const savedBought = (await store.recipes.readAll()).rows.find((r) => r.name === "Frozen pizza");
    expect(savedBought?.indivisible).toBeUndefined();
  });

  it("explicitly overriding the control persists indivisible on the saved row", async () => {
    const store = createFakeWorkbookStore();
    const user = userEvent.setup();

    renderEditor(contextValue(store), "/recipes/new");
    await user.type(await screen.findByLabelText("Name"), "Big batch soup");
    // Kind stays Cooked (indivisible defaults to false) — explicitly check
    // "Can't be split" anyway (a single 9-inch quiche can't be split either,
    // per §4).
    await user.click(screen.getByRole("radio", { name: "Can't be split" }));
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    await screen.findByText("Recipes list");

    const saved = (await store.recipes.readAll()).rows.find((r) => r.name === "Big batch soup");
    expect(saved?.indivisible).toBe(true);
  });
});

/** DESIGN_PURCHASING.md §10 — the per-ingredient-line entry-unit picker. */
describe("RecipeEditor — recipe entry units (DESIGN_PURCHASING.md §10)", () => {
  function flour(): Ingredient {
    return {
      id: makeIngredientId("flour"),
      name: "Flour",
      unit: "g",
      shelfLifeDays: 365,
      openedShelfLifeDays: 365,
      defaultLocation: "pantry",
      gramsPerMl: 0.5417,
    };
  }

  it("typing an amount in the ingredient's own canonical unit needs no conversion — no display fields saved", async () => {
    const store = createFakeWorkbookStore();
    await store.ingredients.upsert(flour());
    const user = userEvent.setup();

    renderEditor(contextValue(store), "/recipes/new");
    await user.type(await screen.findByLabelText("Name"), "Plain bread");
    await user.click(screen.getByRole("button", { name: "Add ingredient line" }));
    await user.click(screen.getByRole("button", { name: /^ingredient\b/i }));
    await user.click(await screen.findByRole("option", { name: "Flour" }));
    await user.type(screen.getByLabelText(/Amount/), "450");
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    await screen.findByText("Recipes list");

    const lines = (await store.recipeIngredients.readAll()).rows;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toEqual({ amount: 450, unit: "g" });
    expect(lines[0]?.displayQuantity).toBeUndefined();
    expect(lines[0]?.displayUnit).toBeUndefined();
  });

  it("picking a different entry unit (cup) converts once at save and keeps what was typed as provenance", async () => {
    const store = createFakeWorkbookStore();
    await store.ingredients.upsert(flour());
    const user = userEvent.setup();

    renderEditor(contextValue(store), "/recipes/new");
    await user.type(await screen.findByLabelText("Name"), "Pancakes");
    await user.click(screen.getByRole("button", { name: "Add ingredient line" }));
    await user.click(screen.getByRole("button", { name: /^ingredient\b/i }));
    await user.click(await screen.findByRole("option", { name: "Flour" }));

    // The unit picker defaults to the ingredient's own canonical unit ("g")
    // — switch it to "cup" (offered because Flour has a density set).
    await user.click(screen.getByRole("button", { name: /^unit\b/i }));
    await user.click(await screen.findByRole("option", { name: "cup" }));
    await user.type(screen.getByLabelText(/Amount/), "1");

    // §10.5: the conversion preview shows the household both what they
    // typed and the canonical number the app is reasoning about.
    expect(await screen.findByText(/1 cup flour \(130(\.\d)? g\)/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    await screen.findByText("Recipes list");

    const lines = (await store.recipeIngredients.readAll()).rows;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity.unit).toBe("g");
    expect(lines[0]?.quantity.amount).toBeCloseTo(130.008, 2);
    expect(lines[0]?.displayQuantity).toBe(1);
    expect(lines[0]?.displayUnit).toBe("cup");
  });

  it("an ingredient with no density offers only mass units — no unit picker needed for a single-choice ingredient with just one option", async () => {
    const store = createFakeWorkbookStore();
    const onion: Ingredient = {
      id: makeIngredientId("onion"),
      name: "Onion",
      unit: "piece",
      shelfLifeDays: 30,
      openedShelfLifeDays: 5,
      defaultLocation: "pantry",
    };
    await store.ingredients.upsert(onion);
    const user = userEvent.setup();

    renderEditor(contextValue(store), "/recipes/new");
    await user.type(await screen.findByLabelText("Name"), "Onion soup");
    await user.click(screen.getByRole("button", { name: "Add ingredient line" }));
    await user.click(screen.getByRole("button", { name: /^ingredient\b/i }));
    await user.click(await screen.findByRole("option", { name: "Onion" }));

    // Onion only ever offers "piece" (§10.1 — no cross-dimension data set),
    // so there is nothing to pick — the unit chip doesn't even render.
    expect(screen.queryByRole("button", { name: /^unit$/i })).not.toBeInTheDocument();
  });
});
