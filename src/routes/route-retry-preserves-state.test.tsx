/**
 * Pattern audit #2: "retry means two different things on sibling tabs" —
 * before this package, `ErrorState.onRetry` on Recipes/Ingredients/Home was
 * `() => window.location.reload()`, a full browser navigation. That
 * destroys EVERYTHING on the page, not just the failed route's own data:
 * any text typed elsewhere, scroll position, focus — all gone, because the
 * whole document is torn down and rebuilt from scratch.
 *
 * This proves the fix does NOT do that: `useRecipesData`'s `retry` re-runs
 * only the failed fetch, inside the SAME mounted React tree, so state that
 * has nothing to do with the failed fetch (a value typed into a sibling
 * field, the window's scroll position) survives the retry untouched — a
 * real page reload could not preserve either. Same hook shape as
 * `useIngredientsData.ts`/`useHomeData.ts`, so this one test stands for all
 * three (they're identical in this respect; a full page reload would blow
 * away sibling state exactly the same way regardless of which of the three
 * routes triggered it).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Recipes } from "./Recipes.tsx";
import { ToastProvider, ToastViewport } from "../ui/components";
import { WorkbookContext, type WorkbookContextValue } from "../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../domain/fakes/index.ts";
import { makeIsoDate, makeIsoTimestamp, makeRecipeId, type Recipe } from "../domain/index.ts";

const TODAY = makeIsoDate("2026-08-21");

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

/** A field that has nothing to do with Recipes' own data load — stands in for "whatever else the user had typed or scrolled to on the page" (e.g. a value in a different part of the app shell). Rendered as a SIBLING of `<Recipes/>`, in the same mounted tree, the way `AppShell` really renders route content alongside persistent chrome. */
function Harness() {
  return (
    <MemoryRouter>
      <WorkbookContext.Provider value={contextValueRef.current}>
        <ToastProvider>
          <input aria-label="Unrelated page state" data-testid="outside-input" />
          <Recipes />
          <ToastViewport />
        </ToastProvider>
      </WorkbookContext.Provider>
    </MemoryRouter>
  );
}

// Set by each test before render — avoids re-declaring the whole harness per test.
const contextValueRef: { current: WorkbookContextValue } = {
  current: null as unknown as WorkbookContextValue,
};

describe("Recipes route — soft retry preserves state a hard reload would destroy", () => {
  it("keeps sibling typed text and scroll position across an ErrorState retry, and never calls window.location.reload", async () => {
    const store = createFakeWorkbookStore();
    await store.recipes.upsert(recipe());

    const readAllSpy = vi.spyOn(store.recipes, "readAll");
    readAllSpy.mockRejectedValueOnce(new Error("Sheets read failed"));

    contextValueRef.current = {
      store,
      clock: createFixedClock(makeIsoTimestamp("2026-08-21T18:00:00.000Z"), TODAY),
      rng: createFakeRng(1),
      workbookId: "wb-1",
      outbox: createFakeOutbox(),
      user: { name: "Fabio", email: "fabio@example.com" },
    };

    // jsdom's window.location.reload throws "Not implemented" by default —
    // stub it so a regression back to the old behaviour fails loudly here
    // (asserted on below) instead of just crashing on an unrelated jsdom
    // error.
    const reloadSpy = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: reloadSpy });

    try {
      render(<Harness />);

      // The failed load surfaces Recipes' ErrorState — no search box yet
      // (gated on a successful load), but the sibling field and the page's
      // scroll are both independent of that.
      const retryButton = await screen.findByRole("button", { name: "Try again" });

      const user = userEvent.setup();
      await user.type(screen.getByTestId("outside-input"), "hello from elsewhere");
      // jsdom doesn't implement window.scrollTo — set the read-only
      // `scrollY` directly, the same effect a real scroll would have.
      Object.defineProperty(window, "scrollY", { configurable: true, value: 340 });
      expect(window.scrollY).toBe(340);

      await user.click(retryButton);

      // Retry succeeds this time (readAllSpy falls through to the real
      // fake-store implementation on every call after the first).
      await waitFor(() => expect(screen.getByText("Weeknight Pasta")).toBeInTheDocument());

      // The proof: state that has nothing to do with the failed fetch
      // survived the retry. A `window.location.reload()` could not have
      // preserved either of these — it tears down the whole document.
      expect(screen.getByTestId("outside-input")).toHaveValue("hello from elsewhere");
      expect(window.scrollY).toBe(340);
      expect(reloadSpy).not.toHaveBeenCalled();

      // And the retry really did re-fetch, not just re-render stale data.
      expect(readAllSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
