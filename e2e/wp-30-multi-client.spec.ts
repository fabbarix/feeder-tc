import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { addRecipe } from "./support/recipes.ts";
import { addPantryStock } from "./support/pantry.ts";
import { bridgedPath, createSharedWorkbookBackend } from "./support/shared-workbook.ts";

// WP-30 (IMPLEMENTATION_PLAN.md): "add multi-client scenario (two browser
// contexts, one workbook: concurrent appends both land; plain-row LWW edit
// warns on stale save)". Desktop-only (see playwright.config.ts's testIgnore
// for this file on the "mobile-chrome" project) — two-context concurrency
// doesn't depend on viewport, and doubling it there would only cost runtime.
//
// Both scenarios use e2e/support/shared-workbook.ts, NOT the standard
// src/mocks/handlers.ts msw browser worker: that mock's in-memory fake lives
// inside whichever PAGE last called `setupWorker(...)`, so two browser
// contexts hitting "the same" mocked spreadsheet id would each get their
// own, independent workbook — see that module's own doc comment for why.

test.describe("Multi-client: two browser contexts, one workbook", () => {
  test("concurrent appends from two clients both land (invariant 1: InventoryEvents are additive, never coalesced or overwritten)", async ({
    browser,
  }) => {
    const backend = createSharedWorkbookBackend({ spreadsheetId: "wp30-concurrent-appends" });
    try {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      await backend.install(ctxA);
      await backend.install(ctxB);
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      // Client A is the household member who sets the workbook up.
      await enterReadyShell(pageA, bridgedPath("pantry"));

      // Client B is a second device signing into the SAME household sheet —
      // "Open existing…" (the Picker), not "Create new meal planner": this
      // backend hands back one fixed spreadsheet id either way, so a second
      // "create" would re-run bootstrap against the ALREADY-bootstrapped
      // workbook and duplicate the seeded ingredient catalog.
      await pageB.goto(bridgedPath("pantry"));
      await pageB.getByRole("button", { name: "Sign in with Google" }).click();
      await pageB.getByRole("button", { name: "Open existing…" }).click();
      await expect(pageB.getByRole("navigation", { name: "Primary" })).toBeVisible({ timeout: 20_000 });

      // When both clients add rice stock at the same time — `Promise.all`
      // fires both submissions before awaiting either, so the two appends
      // genuinely overlap in flight rather than merely both eventually
      // succeeding one after the other.
      await Promise.all([addPantryStock(pageA, "Rice", "500"), addPantryStock(pageB, "Rice", "700")]);

      // Then a fresh client (this app never persists the access token, so
      // re-entering always re-syncs from the workbook rather than reading
      // back either page's own locally-cached optimistic state) sees BOTH
      // lots landed, summed — neither client's write silently overwrote the
      // other's.
      await enterReadyShell(pageA, bridgedPath("pantry"));
      await expect(pageA.getByRole("main")).toContainText("1200 g");
    } finally {
      backend.close();
    }
  });

  test("a plain-row edit warns on a stale save instead of silently clobbering a concurrent household member's edit", async ({
    browser,
  }) => {
    const backend = createSharedWorkbookBackend({ spreadsheetId: "wp30-lww-recipe" });
    try {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      await backend.install(ctxA);
      await backend.install(ctxB);
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      await enterReadyShell(pageA, bridgedPath());
      await addRecipe(pageA, "Weeknight Pasta", 20);

      await pageB.goto(bridgedPath());
      await pageB.getByRole("button", { name: "Sign in with Google" }).click();
      await pageB.getByRole("button", { name: "Open existing…" }).click();
      await expect(pageB.getByRole("navigation", { name: "Primary" })).toBeVisible({ timeout: 20_000 });

      // Both open the SAME recipe's editor before either saves — each now
      // holds the row exactly as it stood before any edit this test makes.
      await pageA.getByRole("link", { name: /Weeknight Pasta/ }).click();
      await pageA.getByRole("link", { name: "Edit" }).click();
      await expect(pageA.getByRole("heading", { name: "Edit recipe" })).toBeVisible();

      await pageB.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipes", exact: true }).click();
      await pageB.getByRole("link", { name: /Weeknight Pasta/ }).click();
      await pageB.getByRole("link", { name: "Edit" }).click();
      await expect(pageB.getByRole("heading", { name: "Edit recipe" })).toBeVisible();

      // Client A saves first — no conflict yet, this is the first write
      // since either editor loaded.
      await pageA.getByRole("textbox", { name: "Name" }).fill("Weeknight Pasta (A's edit)");
      await pageA.getByRole("button", { name: "Save recipe" }).click();
      await expect(pageA.getByRole("heading", { name: "Recipes" })).toBeVisible();

      // Client B, unaware, edits the same recipe from its own (now stale)
      // load and tries to save.
      await pageB.getByRole("textbox", { name: "Name" }).fill("Weeknight Pasta (B's edit)");
      await pageB.getByRole("button", { name: "Save recipe" }).click();

      // Warned, not silently clobbered — B is still on the edit form, and
      // nothing has been written on B's behalf yet.
      const conflictDialog = pageB.getByRole("heading", { name: "This recipe changed elsewhere" });
      await expect(conflictDialog).toBeVisible();
      await expect(pageB.getByRole("textbox", { name: "Name" })).toHaveValue("Weeknight Pasta (B's edit)");

      // Choosing "Keep editing" saves nothing — A's save survives untouched.
      await pageB.getByRole("button", { name: "Keep editing" }).click();
      await expect(conflictDialog).toHaveCount(0);
      await enterReadyShell(pageA, bridgedPath("recipes"));
      await expect(pageA.getByRole("link", { name: /Weeknight Pasta \(A's edit\)/ })).toBeVisible();

      // Client B explicitly chooses to overwrite anyway — the LWW contract
      // (HANDOVER §4: "no locking, no version columns") still ultimately
      // lets the last write win, but only once a human has been told there
      // IS a conflict, not silently.
      await pageB.getByRole("button", { name: "Save recipe" }).click();
      await expect(conflictDialog).toBeVisible();
      await pageB.getByRole("button", { name: "Save anyway" }).click();
      await expect(pageB.getByRole("heading", { name: "Recipes" })).toBeVisible();

      await enterReadyShell(pageA, bridgedPath("recipes"));
      await expect(pageA.getByRole("link", { name: /Weeknight Pasta \(B's edit\)/ })).toBeVisible();
    } finally {
      backend.close();
    }
  });
});
