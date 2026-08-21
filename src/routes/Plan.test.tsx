import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plan } from "./Plan.tsx";
import { ToastProvider } from "../ui/components/Toast/ToastProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../domain/fakes/index.ts";
import {
  makeIsoDate,
  makeIsoTimestamp,
  makePlanSlotId,
  makeRecipeId,
  type PlanSlot,
  type Recipe,
  type Settings,
  type WorkbookStore,
} from "../domain/index.ts";

const MONDAY = makeIsoDate("2026-08-17");

const SETTINGS: Settings = {
  householdSize: 2,
  slotLayout: [{ day: "monday", slots: ["dinner"] }],
  repeatExclusionWeeks: 3,
  currency: "$",
};

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: makeRecipeId("pasta"),
    name: "Weeknight Pasta",
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    mealTags: ["dinner"],
    status: "in-rotation",
    ...overrides,
  };
}

function slot(overrides: Partial<PlanSlot> = {}): PlanSlot {
  return {
    id: makePlanSlotId("slot-mon-dinner"),
    date: MONDAY,
    slotType: "dinner",
    slotIndex: 0,
    filling: { kind: "recipe", recipeId: makeRecipeId("pasta") },
    state: "planned",
    pinned: false,
    ...overrides,
  };
}

async function seed(store: WorkbookStore, initialSlot: PlanSlot): Promise<void> {
  await store.settings.write(SETTINGS);
  await store.recipes.upsert(recipe());
  await store.planSlots.upsert(initialSlot);
}

function renderPlan(store: WorkbookStore) {
  const contextValue: WorkbookContextValue = {
    store,
    clock: createFixedClock(makeIsoTimestamp("2026-08-17T12:00:00.000Z"), MONDAY),
    rng: createFakeRng(1),
    workbookId: "wb-1",
    outbox: createFakeOutbox(),
  };
  return render(
    <WorkbookContext.Provider value={contextValue}>
      <ToastProvider>
        <Plan />
      </ToastProvider>
    </WorkbookContext.Provider>,
  );
}

/**
 * WP-stale-save: `usePlanWeek.ts`'s `persistSlot` (backing reroll/pin/pick/
 * clear/scale/mark-cooked) was one of the blind write sites this workstream
 * closes — every one of those actions used to spread the LOCAL slot this
 * render already had, so a household member's own concurrent change to a
 * DIFFERENT field on the exact same slot got silently reverted. This is the
 * "per-item toggle: protect other fields, not the toggle itself" case (no
 * ConfirmDialog — see `persistSlot`'s own doc comment) — pin/unpin here,
 * merged onto the freshest row rather than a stale local copy.
 */
describe("Plan — per-slot stale-save protection (refresh-before-edit merge)", () => {
  it("pinning a slot doesn't revert a recipe swap another client already saved", async () => {
    const store = createFakeWorkbookStore();
    await seed(store, slot());

    renderPlan(store);
    await screen.findAllByText("Weeknight Pasta");

    // Another household member picks a different recipe for this exact
    // slot AFTER this route loaded its own copy.
    const otherRecipe = recipe({ id: makeRecipeId("soup"), name: "Tomato Soup" });
    await store.recipes.upsert(otherRecipe);
    await store.planSlots.upsert(slot({ filling: { kind: "recipe", recipeId: otherRecipe.id } }));

    // The desktop grid and the mobile day-list both render (CSS-only
    // responsive — PlanSlotRow appears twice); either copy's "Pin" button
    // drives the same `usePlanWeek` action, so the first is fine.
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Pin" })[0]!);

    await waitFor(async () => {
      const saved = (await store.planSlots.readAll()).rows.find((s) => s.id === slot().id);
      expect(saved?.pinned).toBe(true);
    });

    // The concurrent recipe swap survives the pin toggle — this write only
    // ever intended to flip `pinned`.
    const saved = (await store.planSlots.readAll()).rows.find((s) => s.id === slot().id);
    expect(saved?.filling).toEqual({ kind: "recipe", recipeId: otherRecipe.id });
  });

  it("generating the week warns instead of silently discarding a concurrent change, and only overwrites once confirmed", async () => {
    const store = createFakeWorkbookStore();
    await seed(store, slot({ pinned: true }));

    renderPlan(store);
    await screen.findAllByText("Weeknight Pasta");

    // Someone else unpins the slot after this route loaded the week.
    await store.planSlots.upsert(slot({ pinned: false }));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Generate week" }));

    const conflictDialog = await screen.findByRole("heading", { name: "This week changed elsewhere" });
    expect(conflictDialog).toBeInTheDocument();

    // Not silently overwritten — the concurrent unpin is exactly as that
    // other client left it.
    const midway = (await store.planSlots.readAll()).rows.find((s) => s.id === slot().id);
    expect(midway?.pinned).toBe(false);

    await user.click(screen.getByRole("button", { name: "Keep this week" }));
    expect(screen.queryByRole("heading", { name: "This week changed elsewhere" })).not.toBeInTheDocument();
    const stillMidway = (await store.planSlots.readAll()).rows.find((s) => s.id === slot().id);
    expect(stillMidway?.pinned).toBe(false);
  });
});
