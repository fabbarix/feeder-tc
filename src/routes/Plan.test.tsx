import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
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
  const router = createMemoryRouter(
    [
      { path: "/plan", element: <Plan /> },
      { path: "/plan/month", element: <Plan /> },
    ],
    { initialEntries: ["/plan"] },
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

/**
 * design/mock-responsive.html § "Removing a plan entry — corrects the
 * record, never erases it silently": Remove is reachable on every filled
 * slot, with two confirm variants. `MONDAY` (2026-08-17) is both "today"
 * (the fixed clock) and the only configured slot day (`SETTINGS.slotLayout`),
 * so the future-slot case uses it directly and the past/cooked case reuses
 * the same weekday a week earlier via "Previous week".
 */
describe("Plan — Remove from plan", () => {
  it("future slot: one-sentence confirm; removing empties the slot and leaves it plannable again", async () => {
    const store = createFakeWorkbookStore();
    await seed(store, slot());
    renderPlan(store);
    await screen.findAllByText("Weeknight Pasta");

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Remove from plan" })[0]!);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Remove Weeknight Pasta — Monday dinner?" })).toBeInTheDocument();
    expect(within(dialog).getByText("Nothing's been cooked yet — this just clears the slot.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/doesn.t undo the cooking/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Remove from plan" }));

    await waitFor(async () => {
      const saved = (await store.planSlots.readAll()).rows.find((s) => s.id === slot().id);
      expect(saved?.filling).toEqual({ kind: "empty" });
    });
    const saved = (await store.planSlots.readAll()).rows.find((s) => s.id === slot().id);
    expect(saved?.state).toBe("planned");
    expect(saved?.pinned).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Pick a meal for Dinner" }).length).toBeGreaterThan(0);
    });
  });

  it("past, already-cooked slot: confirm names invariant 1; removing corrects the plan without touching any InventoryEvent", async () => {
    const pastMonday = makeIsoDate("2026-08-10");
    const pastSlot = slot({ id: makePlanSlotId("slot-past-mon-dinner"), date: pastMonday, state: "cooked" });
    const store = createFakeWorkbookStore();
    await seed(store, pastSlot);
    renderPlan(store);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Previous week" }));
    await screen.findAllByText("Weeknight Pasta");
    await screen.findAllByText("Cooked");

    const eventsBefore = (await store.inventoryEvents.readFrom(0)).rows.length;

    await user.click(screen.getAllByRole("button", { name: "Remove from plan" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Remove Weeknight Pasta — Monday dinner?" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Monday has already passed/)).toBeInTheDocument();
    expect(within(dialog).getByText(/doesn.t undo the cooking/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Remove from plan" }));

    await waitFor(async () => {
      const saved = (await store.planSlots.readAll()).rows.find((s) => s.id === pastSlot.id);
      expect(saved?.filling).toEqual({ kind: "empty" });
    });
    const saved = (await store.planSlots.readAll()).rows.find((s) => s.id === pastSlot.id);
    // Corrected back to "planned" (plannable again), not left dangling as a
    // "cooked" row with nothing in it — see `removeSlot`'s own doc comment.
    expect(saved?.state).toBe("planned");

    // Invariant 1: no InventoryEvent was appended, edited, or removed.
    const eventsAfter = (await store.inventoryEvents.readFrom(0)).rows.length;
    expect(eventsAfter).toBe(eventsBefore);
  });
});

describe("Plan — Today button", () => {
  it("returns to the current week after navigating away", async () => {
    const store = createFakeWorkbookStore();
    await seed(store, slot());
    renderPlan(store);
    await screen.findAllByText("Weeknight Pasta");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Next week" }));
    await user.click(await screen.findByRole("button", { name: "Next week" }));
    // Navigated away: this week's Monday recipe is no longer on screen.
    expect(screen.queryAllByText("Weeknight Pasta")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Today" }));
    await screen.findAllByText("Weeknight Pasta");
  });
});

describe("Plan — month/quarter view", () => {
  it("switches to /plan/month via the Week/Month toggle and shows the month grid plus a 3-month quarter strip", async () => {
    const store = createFakeWorkbookStore();
    await seed(store, slot());
    renderPlan(store);
    await screen.findAllByText("Weeknight Pasta");

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Month" }));

    await screen.findByText("August 2026");
    // The quarter strip: same month plus the following two.
    expect(screen.getByText("August")).toBeInTheDocument();
    expect(screen.getByText("September")).toBeInTheDocument();
    expect(screen.getByText("October")).toBeInTheDocument();

    // Clicking a day cell opens that week and switches back to /plan. Two
    // matches exist (the main month grid's cell and the quarter strip's
    // own August mini-grid renders the same date) — the main grid's is
    // first in the DOM.
    await user.click(screen.getAllByRole("button", { name: /2026-08-17 \(today\)/ })[0]!);
    await screen.findAllByText("Weeknight Pasta");
    expect(screen.getByRole("radio", { name: "Week" })).toBeChecked();
  });
});
