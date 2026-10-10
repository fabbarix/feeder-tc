import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings.tsx";
import { ToastProvider } from "../ui/components/Toast/ToastProvider.tsx";
import { ThemeProvider } from "../ui/theme/ThemeProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../domain/fakes/index.ts";
import { makeIsoDate, makeIsoTimestamp, makeRecipeId, type Settings as SettingsRow, type WorkbookStore } from "../domain/index.ts";

const NO_SETTINGS_ROW_ERROR = "This meal planner doesn't have any settings saved yet.";

/** A store whose `settings.read()` throws exactly what `decodeSettings` throws for a workbook with no "general" row yet — everything else delegates to a normal in-memory fake. */
function createStoreMissingSettingsRow(): WorkbookStore {
  const store = createFakeWorkbookStore();
  return {
    ...store,
    settings: {
      read: () => Promise.reject(new Error(NO_SETTINGS_ROW_ERROR)),
      write: store.settings.write,
    },
  };
}

function renderSettings(store: WorkbookStore) {
  const contextValue: WorkbookContextValue = {
    store,
    clock: createFixedClock(makeIsoTimestamp("2026-08-21T12:00:00.000Z"), makeIsoDate("2026-08-21")),
    rng: createFakeRng(1),
    workbookId: "wb-1",
    outbox: createFakeOutbox(),
  };
  return render(
    <ThemeProvider>
      <WorkbookContext.Provider value={contextValue}>
        <ToastProvider>
          <Settings />
        </ToastProvider>
      </WorkbookContext.Provider>
    </ThemeProvider>,
  );
}

/**
 * Regression test for WP-31's onboarding-copy fix: a workbook whose
 * `Settings` sheet has no data row yet (old enough to predate this feature,
 * or one PR #36's schema self-heal only just gave the tab/header back to)
 * used to surface `decodeSettings`'s raw throw as a dead-end `ErrorState` —
 * "the workbook was not bootstrapped correctly", with a "Try again" button
 * that would only ever fail the same way again. This asserts the recovery
 * path instead: a real action that fixes it, wired to the same
 * `DEFAULT_SETTINGS` a brand-new workbook gets.
 *
 * WP-tokens follow-up (jargon sweep, third pass): the "sheet"/"row"/
 * "bootstrapped" wording above described the ORIGINAL bug, not today's
 * copy — `decodeSettings` itself now throws the same plain-language string
 * this test asserts against, so a route that ever forgets to add its own
 * recovery UI (the way Plan.tsx's ErrorState did) still shows something a
 * user can read, not just this route.
 */
describe("Settings — no Settings row yet (WP-31)", () => {
  it("offers 'Set up defaults' instead of a dead-end error, and it actually works", async () => {
    renderSettings(createStoreMissingSettingsRow());

    // Not the generic, non-actionable error surface...
    expect(await screen.findByText(/no settings saved yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load settings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(NO_SETTINGS_ROW_ERROR)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /set up defaults/i }));

    // The full editor mounts once defaults are written.
    expect(await screen.findByText("Meals")).toBeInTheDocument();
    expect(screen.getByLabelText("Fewer — Household size")).toBeInTheDocument();
    expect(screen.queryByText(/no settings saved yet/i)).not.toBeInTheDocument();
  });

  it("still shows a retryable error for a genuinely different load failure", async () => {
    const store = createFakeWorkbookStore();
    const broken: WorkbookStore = {
      ...store,
      settings: {
        read: () => Promise.reject(new Error("Network request failed")),
        write: store.settings.write,
      },
    };
    renderSettings(broken);

    expect(await screen.findByText(/couldn't load settings/i)).toBeInTheDocument();
    expect(screen.getByText("Network request failed")).toBeInTheDocument();
    expect(screen.queryByText(/set up defaults/i)).not.toBeInTheDocument();
  });
});

/**
 * WP-stale-save: `useSettings.ts`'s `settings.write` was one of the blind
 * write sites this workstream closes. Unlike the whole-form editors
 * (RecipeEditor.tsx/IngredientEditor.tsx), Settings never gets a
 * ConfirmDialog — see that hook's own doc comment for why (rapid taps, no
 * discrete Save). Instead this proves the refresh-before-edit MERGE: a
 * concurrent household member's slot-layout change survives a household-
 * size tap on a different device that loaded the row before that change
 * landed.
 */
describe("Settings — stale-save protection (refresh-before-edit merge)", () => {
  it("a household-size tap doesn't revert a meal slot another client already added", async () => {
    const store = createFakeWorkbookStore();
    const initial: SettingsRow = {
      householdSize: 2,
      slotLayout: [{ day: "monday", slots: ["breakfast", "lunch", "dinner"] }],
      repeatExclusionWeeks: 3,
      currency: "$",
    };
    await store.settings.write(initial);

    renderSettings(store);
    await screen.findByText("Meals");

    // Another household member (or another tab) adds a Tuesday breakfast
    // slot AFTER this route loaded its own copy of `settings`.
    await store.settings.write({
      ...initial,
      slotLayout: [...initial.slotLayout, { day: "tuesday", slots: ["breakfast"] }],
    });

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("More — Household size"));

    await waitFor(async () => {
      const saved = await store.settings.read();
      expect(saved.householdSize).toBe(3);
    });

    // The concurrent slot addition is NOT clobbered by this tap's write —
    // this is the "protect other fields, not the toggle itself" case, not a
    // whole-row blind overwrite.
    const saved = await store.settings.read();
    expect(saved.slotLayout).toHaveLength(2);
    expect(saved.slotLayout.some((d) => d.day === "tuesday")).toBe(true);
  });
});

describe("Settings — meal types (custom meal types)", () => {
  async function setUp(): Promise<WorkbookStore> {
    const store = createFakeWorkbookStore();
    await store.settings.write({
      householdSize: 4,
      slotLayout: [
        { day: "monday", slots: ["breakfast", "dinner"] },
        { day: "tuesday", slots: ["dinner"] },
      ],
      repeatExclusionWeeks: 3,
      currency: "$",
    });
    renderSettings(store);
    await screen.findByText("Meals");
    return store;
  }

  it("adds a meal type with its own servings, on every day once", async () => {
    const store = await setUp();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add a meal type" }));
    await user.type(screen.getByLabelText("Name"), "Cat's breakfast");
    await user.click(screen.getByLabelText(/Feeds the household/));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(async () => {
      const saved = await store.settings.read();
      expect(saved.mealTypes?.at(-1)).toEqual({ id: "cats-breakfast", name: "Cat's breakfast", servings: 1 });
      expect(saved.slotLayout.find((d) => d.day === "sunday")?.slots).toEqual(["cats-breakfast"]);
      expect(saved.slotLayout.find((d) => d.day === "monday")?.slots).toEqual(["breakfast", "dinner", "cats-breakfast"]);
    });
    expect(await screen.findByText("serves 1")).toBeInTheDocument();
  });

  it("gives a day two of the same meal from the row's per-day count", async () => {
    const store = await setUp();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "More Dinner per day" }));

    await waitFor(async () => {
      const saved = await store.settings.read();
      expect(saved.slotLayout.find((d) => d.day === "monday")?.slots).toEqual(["breakfast", "dinner", "dinner"]);
      expect(saved.slotLayout.find((d) => d.day === "tuesday")?.slots).toEqual(["dinner", "dinner"]);
    });
  });

  it("toggles a meal on for a day", async () => {
    const store = await setUp();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Breakfast on Tue" }));

    await waitFor(async () => {
      const saved = await store.settings.read();
      expect(saved.slotLayout.find((d) => d.day === "tuesday")?.slots).toEqual(["breakfast", "dinner"]);
    });
  });

  it("won't remove a meal type a recipe is still tagged with, and says why", async () => {
    const store = await setUp();
    await store.recipes.upsert({
      id: makeRecipeId("porridge"),
      name: "Porridge",
      kind: "cooked",
      baseServings: 2,
      prepMinutes: 5,
      cookMinutes: 10,
      mealTags: ["breakfast"],
      status: "in-rotation",
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit Breakfast" }));
    await user.click(screen.getByRole("button", { name: /Remove this meal type/ }));

    expect(await screen.findByText(/1 recipe is tagged with it/)).toBeInTheDocument();
    expect((await store.settings.read()).mealTypes).toBeUndefined();
  });

  it("renames a meal type without changing its id", async () => {
    const store = await setUp();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit Dinner" }));
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Supper");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => {
      const saved = await store.settings.read();
      expect(saved.mealTypes?.find((type) => type.id === "dinner")?.name).toBe("Supper");
    });
  });
});
