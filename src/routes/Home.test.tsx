import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Home } from "./Home.tsx";
import { ToastProvider, ToastViewport } from "../ui/components";
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

const TODAY = makeIsoDate("2026-08-21");

const SETTINGS: Settings = {
  householdSize: 2,
  slotLayout: [{ day: "friday", slots: ["dinner"] }],
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

function tonightSlot(overrides: Partial<PlanSlot> = {}): PlanSlot {
  return {
    id: makePlanSlotId("slot-tonight"),
    date: TODAY,
    slotType: "dinner",
    slotIndex: 0,
    filling: { kind: "recipe", recipeId: makeRecipeId("pasta") },
    state: "planned",
    pinned: false,
    ...overrides,
  };
}

function renderHome(store: WorkbookStore) {
  const contextValue: WorkbookContextValue = {
    store,
    clock: createFixedClock(makeIsoTimestamp("2026-08-21T18:00:00.000Z"), TODAY),
    rng: createFakeRng(1),
    workbookId: "wb-1",
    outbox: createFakeOutbox(),
    user: { name: "Fabio", email: "fabio@example.com" },
  };
  return render(
    <MemoryRouter>
      <WorkbookContext.Provider value={contextValue}>
        <ToastProvider>
          <Home />
          <ToastViewport />
        </ToastProvider>
      </WorkbookContext.Provider>
    </MemoryRouter>,
  );
}

/**
 * WP-stale-save: Home.tsx's "Mark cooked" quick action wrote a full
 * `PlanSlot` row built from `tonightSlot` — this route's OWN local copy,
 * loaded once at mount — a blind write that could revert a pin/scale/recipe
 * change another household member made to the exact same slot in the
 * meantime. This proves the merge: marking cooked from the dashboard
 * doesn't clobber a concurrent pin.
 */
describe("Home — 'Mark cooked' stale-save protection", () => {
  it("marking tonight cooked doesn't revert a pin another client already set", async () => {
    const store = createFakeWorkbookStore();
    await store.settings.write(SETTINGS);
    await store.recipes.upsert(recipe());
    await store.planSlots.upsert(tonightSlot());

    renderHome(store);
    await screen.findByRole("button", { name: "Mark cooked" });

    // Another household member pins tonight's slot after Home loaded it.
    await store.planSlots.upsert(tonightSlot({ pinned: true }));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mark cooked" }));

    await waitFor(async () => {
      const saved = (await store.planSlots.readAll()).rows.find((s) => s.id === tonightSlot().id);
      expect(saved?.state).toBe("cooked");
    });
    const saved = (await store.planSlots.readAll()).rows.find((s) => s.id === tonightSlot().id);
    expect(saved?.pinned).toBe(true);
  });

  it("toasts instead of resurrecting a slot another client cleared, rather than blindly recreating it", async () => {
    const store = createFakeWorkbookStore();
    await store.settings.write(SETTINGS);
    await store.recipes.upsert(recipe());
    await store.planSlots.upsert(tonightSlot());

    renderHome(store);
    await screen.findByRole("button", { name: "Mark cooked" });

    // Someone else clears tonight's slot entirely (e.g. from Plan) before
    // this click's fresh read runs.
    await store.planSlots.upsert(tonightSlot({ filling: { kind: "empty" }, pinned: false }));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mark cooked" }));

    await screen.findByText("This meal changed elsewhere");
    const saved = (await store.planSlots.readAll()).rows.find((s) => s.id === tonightSlot().id);
    // Still empty — this action never recreated a "cooked" recipe slot out
    // of a row someone else had just cleared.
    expect(saved?.filling.kind).toBe("empty");
  });
});
