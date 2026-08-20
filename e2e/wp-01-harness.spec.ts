import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// Trivial proof that the Playwright harness runs headless against the app,
// through History API routing and the configured base path. Later WPs add real
// @e2e-tagged scenarios from IMPLEMENTATION_PLAN.md (see TESTING.md).
// NOTE on paths: baseURL carries the base path ("http://host:5273/feeder-tc/"),
// and a goto() argument with a LEADING SLASH is resolved against the origin, so
// "/pantry" would silently drop the "/feeder-tc" prefix. Always pass a RELATIVE
// path ("pantry", "" for the index) so it resolves against the base.
//
// UI_DESIGN.md §12 (added mid-WP-15b): every route is gated behind AppShell's
// signed-out → no-workbook → ready states, so these need enterReadyShell()
// first — see e2e/wp-15-shell-gating.spec.ts for the gating behavior itself.
test("navigates from home to the pantry route", async ({ page }) => {
  await enterReadyShell(page);
  await expect(page.getByRole("heading", { name: "Feeder" })).toBeVisible();

  await page.getByRole("link", { name: "Pantry" }).click();
  await expect(page).toHaveURL(/\/pantry$/);
  await expect(page).not.toHaveURL(/#/);
  await expect(page.getByRole("heading", { name: "Pantry" })).toBeVisible();
});

// Deep-linking is the whole point of dropping hash routing, so assert the
// router resolves a nested path with a parameter on a cold load.
//
// NOTE: this does NOT prove the production 404.html fallback works. The dev
// server has its own SPA fallback and answers any path with index.html. The
// real check is `curl -sI https://<host>/recipes/12` against the deployed
// site — see the emit-spa-fallback plugin in vite.config.ts.
test("resolves a deep link with a route parameter on cold load", async ({ page }) => {
  // enterReadyShell(page, path) lands directly on this route before signing
  // in, then signs in from there — a plain `page.goto` after reaching
  // "ready" would be a second full navigation, which drops the in-memory
  // (never-persisted) access token and re-gates the app (see
  // e2e/support/shell.ts).
  await enterReadyShell(page, "recipes/12");
  // WP-20's real RecipeEditor reads the ":recipeId" param and renders "Edit
  // recipe" for any id (id "12" doesn't exist in a fresh workbook, so the
  // body below the heading is an error state — irrelevant to what this
  // test proves: the router resolved the parameterised path at all).
  await expect(page.getByRole("heading", { name: "Edit recipe" })).toBeVisible();
  await expect(page).toHaveURL(/\/recipes\/12$/);
});
