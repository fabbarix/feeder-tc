import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// WP-15 success criterion: "Axe (a11y) checks pass on shell and kit
// stories." This spec covers the shell half (the live app, every stub
// route, via a real Chromium — including `mobile-chrome`); the kit half
// (individual component a11y) is covered by `vitest-axe` in each
// component's co-located `*.test.tsx` (see TESTING.md "Accessibility
// checks"). A later WP adding a new route should add its path here too.
//
// UI_DESIGN.md §12 (added mid-WP-15b): AppShell now gates every route
// behind signed-out → no-workbook → ready, so this spec scans the two gate
// screens explicitly, then walks into "ready" (via enterReadyShell, no real
// Google call — see e2e/support/shell.ts) before scanning each real route.
const ROUTES = [
  "",
  "recipes",
  "recipes/new",
  "recipes/12",
  "recipes/12/edit",
  "recipes/ingredients",
  "recipes/ingredients/new",
  "pantry",
  // WP-VC4: the pantry-item detail route, added this WP — "rice" is always
  // present (the seeded ingredient catalog), even with zero lots yet, so
  // this scans the route's real "no stock" shape rather than an error page.
  "pantry/rice",
  "plan",
  "shopping",
  "settings",
  // M6: the barcode scanner + product editor (DESIGN_PRODUCTS.md §1). Headless
  // Chromium has no camera and no granted permission, so this naturally
  // exercises the "denied"/"unavailable" fallback UI rather than a live feed
  // — exactly the state that must stay accessible (manual entry, never a
  // dead end).
  "scan",
  // M6 (DESIGN_PRODUCTS.md §1.4): the price-history view. "rice" is always
  // present (the seeded catalog) with zero observations, so the
  // ingredient-level route exercises its own empty state.
  "products/prices",
  "products/prices/ingredient/rice",
  // WP-products-screen: browse (empty state — no products seeded) and one
  // product's own detail route with an id that resolves to no row, so it
  // exercises its "no such product" ErrorState — same "scan a route whose
  // param doesn't resolve" convention as "recipes/12" above.
  "products",
  "products/does-not-exist",
];

test("signed-out gate screen has no axe violations", async ({ page }) => {
  await page.goto("");
  await expect(page.getByRole("main")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test("no-workbook gate screen has no axe violations", async ({ page }) => {
  await page.goto("");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByRole("button", { name: "Create new meal planner" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

for (const route of ROUTES) {
  test(`ready route "/${route}" has no axe violations`, async ({ page }) => {
    // enterReadyShell(page, route) lands directly on this route before
    // signing in, then signs in from there — a second `page.goto` after
    // reaching "ready" would drop the in-memory (never-persisted) access
    // token and re-gate the app (see e2e/support/shell.ts).
    await enterReadyShell(page, route);
    // The app boots asynchronously (src/main.tsx awaits the msw browser
    // worker before the first React render), so scanning immediately after
    // goto() can catch an empty <div id="root">. Wait for the shell to be
    // painted first.
    await expect(page.getByRole("main")).toBeVisible();
    // WP-VC3: most routes are now their own `React.lazy` chunk (App.tsx),
    // so `<main>` becoming visible can momentarily mean "the Suspense
    // fallback (App.tsx's RouteFallback) is showing", not "the real route
    // mounted" — the fallback is a bare Skeleton stack with no heading at
    // all, which fails axe's page-has-heading-one rule if the scan lands
    // during that gap. Every real route renders its own <h1> unconditionally
    // (even while ITS OWN data is still loading — e.g. Plan.tsx's <h1>Plan</h1>
    // sits outside its `loading` conditional), so waiting for one more
    // precisely targets "past the Suspense boundary" without hard-coding
    // per-route heading text.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}
