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

function contextValue(store: ReturnType<typeof createFakeWorkbookStore>): WorkbookContextValue {
  return {
    store,
    clock: createFixedClock(makeIsoTimestamp("2026-08-21T12:00:00.000Z"), makeIsoDate("2026-08-21")),
    rng: createFakeRng(1),
    workbookId: "wb-1",
    outbox: createFakeOutbox(),
  };
}

/**
 * DESIGN_PURCHASING.md §8 — "How you buy it" / "How you measure it", both
 * optional groups, collapsed by default. The one rule most likely to be
 * gotten wrong: the pack-size field is ABSENT for Loose, not disabled or
 * greyed — "a Loose ingredient has nothing to round to."
 */
describe("IngredientEditor — How you buy it (DESIGN_PURCHASING.md §8)", () => {
  it("is collapsed by default, with no purchase-mode control in the DOM", async () => {
    const store = createFakeWorkbookStore();
    renderEditor(contextValue(store), "/recipes/ingredients/new");
    await screen.findByLabelText("Name");

    expect(screen.getByRole("button", { name: "+ How you buy it" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Sold as" })).not.toBeInTheDocument();
  });

  it("shows Whole/Loose once expanded, with the pack-size field ABSENT (not disabled) for Loose", async () => {
    const store = createFakeWorkbookStore();
    renderEditor(contextValue(store), "/recipes/ingredients/new");
    await screen.findByLabelText("Name");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ How you buy it" }));

    const sold = screen.getByRole("radiogroup", { name: "Sold as" });
    expect(sold).toBeInTheDocument();
    // "g"/"ml" ingredients default to Loose (§3's table) — nothing filled
    // in here yet, so the new ingredient is still canonical unit "g".
    expect(screen.getByRole("radio", { name: "Loose" })).toBeChecked();
    expect(screen.queryByLabelText(/Pack size/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Container name (optional)")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Whole" }));
    expect(screen.getByLabelText(/Pack size/)).toBeInTheDocument();
    expect(screen.getByLabelText("Container name (optional)")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Loose" }));
    expect(screen.queryByLabelText(/Pack size/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Container name (optional)")).not.toBeInTheDocument();
  });

  it("saves purchaseMode, packSize and packLabel for a new Whole ingredient", async () => {
    const store = createFakeWorkbookStore();
    renderEditor(contextValue(store), "/recipes/ingredients/new");
    await screen.findByLabelText("Name");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Name"), "Mayonnaise");
    await user.click(screen.getByRole("button", { name: "+ How you buy it" }));
    await user.click(screen.getByRole("radio", { name: "Whole" }));
    await user.type(screen.getByLabelText(/Pack size/), "250");
    await user.type(screen.getByLabelText("Container name (optional)"), "jar");
    await user.click(screen.getByRole("button", { name: "Save ingredient" }));

    await screen.findByText("Ingredients list");
    const saved = (await store.ingredients.readAll()).rows.find((i) => i.name === "Mayonnaise");
    expect(saved?.purchaseMode).toBe("whole");
    expect(saved?.packSize).toEqual({ amount: 250, unit: "g" });
    expect(saved?.packLabel).toBe("jar");
  });

  it("clears packSize/packLabel on save after switching an already-Whole ingredient back to Loose", async () => {
    const store = createFakeWorkbookStore();
    const ingredientId = makeIngredientId("mayonnaise");
    await store.ingredients.upsert(
      baseIngredient({
        id: ingredientId,
        name: "Mayonnaise",
        purchaseMode: "whole",
        packSize: { amount: 250, unit: "g" },
        packLabel: "jar",
      }),
    );

    renderEditor(contextValue(store), `/recipes/ingredients/${ingredientId}/edit`);
    await screen.findByDisplayValue("Mayonnaise");

    // The group auto-expands because this ingredient already has data in it.
    const sold = await screen.findByRole("radiogroup", { name: "Sold as" });
    expect(sold).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Whole" })).toBeChecked();

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Loose" }));
    await user.click(screen.getByRole("button", { name: "Save ingredient" }));

    await screen.findByText("Ingredients list");
    const saved = (await store.ingredients.readAll()).rows.find((i) => i.id === ingredientId);
    expect(saved?.purchaseMode).toBe("loose");
    expect(saved?.packSize).toBeUndefined();
    expect(saved?.packLabel).toBeUndefined();
  });
});

/**
 * DESIGN_PURCHASING.md §8's placeholder rule: a seeded default shows as a
 * placeholder, never a pre-filled value, and leaving the field blank must
 * preserve whatever was already stored rather than guessing OR clearing it.
 */
describe("IngredientEditor — How you measure it (DESIGN_PURCHASING.md §8/§10.1a)", () => {
  it("shows the seeded gramsPerMl as a placeholder, not a value, and leaves it untouched on save", async () => {
    const store = createFakeWorkbookStore();
    const ingredientId = makeIngredientId("flour");
    await store.ingredients.upsert(baseIngredient({ id: ingredientId, name: "Flour", gramsPerMl: 0.5417 }));

    renderEditor(contextValue(store), `/recipes/ingredients/${ingredientId}/edit`);
    await screen.findByDisplayValue("Flour");

    const cupField = await screen.findByLabelText(/1 cup weighs/);
    // Placeholder shows the seeded default (0.5417 * 240 = 130 g), but the
    // field itself is blank — an untouched field must be visibly "using the
    // default," never indistinguishable from a household-confirmed number.
    expect(cupField).toHaveValue("");
    expect(cupField).toHaveAttribute("placeholder", "130");

    const user = userEvent.setup();
    // Touch an unrelated field and save without ever typing in the density
    // field — this is the regression case: before this package's fix, a
    // save like this built a brand-new row and silently dropped gramsPerMl.
    await user.click(screen.getByRole("button", { name: "Save ingredient" }));

    await screen.findByText("Ingredients list");
    const saved = (await store.ingredients.readAll()).rows.find((i) => i.id === ingredientId);
    expect(saved?.gramsPerMl).toBe(0.5417);
  });

  it("overrides gramsPerMl when the household types a new cup weight", async () => {
    const store = createFakeWorkbookStore();
    const ingredientId = makeIngredientId("flour");
    await store.ingredients.upsert(baseIngredient({ id: ingredientId, name: "Flour", gramsPerMl: 0.5417 }));

    renderEditor(contextValue(store), `/recipes/ingredients/${ingredientId}/edit`);
    await screen.findByDisplayValue("Flour");

    const user = userEvent.setup();
    const cupField = await screen.findByLabelText(/1 cup weighs/);
    await user.type(cupField, "120");
    await user.click(screen.getByRole("button", { name: "Save ingredient" }));

    await screen.findByText("Ingredients list");
    const saved = (await store.ingredients.readAll()).rows.find((i) => i.id === ingredientId);
    expect(saved?.gramsPerMl).toBeCloseTo(120 / 240);
  });

  it("a brand-new ingredient with no seeded default shows no placeholder and saves with gramsPerMl left unset", async () => {
    const store = createFakeWorkbookStore();
    renderEditor(contextValue(store), "/recipes/ingredients/new");
    await screen.findByLabelText("Name");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Name"), "Made-up sauce");
    await user.click(screen.getByRole("button", { name: "+ How you measure it" }));
    const cupField = screen.getByLabelText(/1 cup weighs/);
    expect(cupField).not.toHaveAttribute("placeholder");

    await user.click(screen.getByRole("button", { name: "Save ingredient" }));
    await screen.findByText("Ingredients list");
    const saved = (await store.ingredients.readAll()).rows.find((i) => i.name === "Made-up sauce");
    expect(saved?.gramsPerMl).toBeUndefined();
  });
});

/**
 * The data-loss bug this package's `handleSave` rewrite fixes: before it,
 * saving through this editor built a brand-new `Ingredient` object with only
 * the fields this form had UI for, so any field the form didn't render at
 * all (`category`) was silently dropped the moment someone else's edit
 * (or this editor's own past self, pre-fix) touched an unrelated field.
 */
describe("IngredientEditor — preserves fields it has no UI for", () => {
  it("keeps an existing category after an unrelated save", async () => {
    const store = createFakeWorkbookStore();
    const ingredientId = makeIngredientId("rolled-oats");
    await store.ingredients.upsert(baseIngredient({ id: ingredientId, category: "baking" }));

    renderEditor(contextValue(store), `/recipes/ingredients/${ingredientId}/edit`);
    await screen.findByDisplayValue("Rolled oats");

    const user = userEvent.setup();
    const nameField = screen.getByLabelText("Name");
    await user.clear(nameField);
    await user.type(nameField, "Steel-cut oats");
    await user.click(screen.getByRole("button", { name: "Save ingredient" }));

    await screen.findByText("Ingredients list");
    const saved = (await store.ingredients.readAll()).rows.find((i) => i.id === ingredientId);
    expect(saved?.category).toBe("baking");
  });
});
