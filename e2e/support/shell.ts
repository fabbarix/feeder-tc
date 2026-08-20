import { expect, type Page } from "@playwright/test";

/**
 * WP-20 wired the real `createGoogleAuth`/workbook-registry/Picker into
 * `AppShell` (UI_DESIGN.md §12) — msw (`src/mocks/handlers.ts`) fakes the
 * GIS/gapi scripts, the Sheets REST surface and Drive's `about.get`, so no
 * real Google API is ever called.
 *
 * The access token deliberately lives only in memory for the life of the
 * tab (never persisted — HANDOVER.md invariant 8 / WP-10's "no Google call
 * before a user gesture"), so a real browser navigation (`page.goto`)
 * always drops back to signed-out: there is nothing to silently resume
 * from, and resuming silently would itself be a Google call with no
 * gesture behind it. Client-side navigation (clicking a
 * `<Link>`/`<NavLink>`) is unaffected — it never reloads the page.
 *
 * The workbook REGISTRY (which spreadsheet is active), unlike the token,
 * IS a real `localStorage`-backed bookmark (`src/sheets/registry.ts`) and
 * therefore survives a reload within the same browser context — so calling
 * this helper more than once in one test (e.g. re-establishing "ready" at a
 * different deep link) can land straight on "ready" after sign-in, with no
 * "Create new meal planner" step at all, once an earlier call in the same
 * test already created one. Both outcomes are handled below rather than
 * assumed.
 *
 * `path` lands the shell at that route BEFORE signing in (a relative path,
 * per TESTING.md), so callers that need "ready, at a specific deep link"
 * get there in one `goto` instead of "ready" then a second `goto` that
 * would immediately re-gate the app.
 */
export async function enterReadyShell(page: Page, path = ""): Promise<void> {
  await page.goto(path);
  await page.getByRole("button", { name: "Sign in with Google" }).click();

  const nav = page.getByRole("navigation", { name: "Primary" });
  const createButton = page.getByRole("button", { name: "Create new meal planner" });

  // Bootstrapping a fresh workbook writes nine sheet headers plus the
  // ~100-row seeded ingredient catalog sequentially
  // (src/sheets/bootstrap.ts), so this can take noticeably longer than the
  // default 5s assertion timeout even against msw's in-process fake
  // transport — allow generously for either outcome.
  await Promise.race([
    nav.waitFor({ state: "visible", timeout: 20_000 }),
    createButton.waitFor({ state: "visible", timeout: 20_000 }),
  ]);

  if (await createButton.isVisible()) {
    await createButton.click();
    await expect(nav).toBeVisible({ timeout: 20_000 });
  }
}
