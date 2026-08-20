import { expect, test } from "@playwright/test";

// WP-15 success criterion: "All routes render stubs; navigation E2E test
// passes on mobile viewport." This spec runs under every configured
// Playwright project (see playwright.config.ts) — including `mobile-chrome`
// (Pixel 7) — so it is the mobile-viewport navigation test.
//
// Paths are RELATIVE ("recipes", not "/recipes") per TESTING.md: a leading
// slash resolves against the origin and drops the base path.
const ROUTES: ReadonlyArray<{ path: string; navLabel: string; heading: string }> = [
  { path: "", navLabel: "Home", heading: "Feeder" },
  { path: "recipes", navLabel: "Recipes", heading: "Recipes" },
  { path: "pantry", navLabel: "Pantry", heading: "Pantry" },
  { path: "plan", navLabel: "Plan", heading: "Plan" },
  { path: "shopping", navLabel: "Shopping", heading: "Shopping" },
  { path: "settings", navLabel: "Settings", heading: "Settings" },
];

test("navigates to every section via the primary nav and back to home", async ({ page }) => {
  await page.goto("");
  await expect(page.getByRole("heading", { name: "Feeder" })).toBeVisible();

  for (const route of ROUTES.filter((r) => r.path !== "")) {
    await page.getByRole("link", { name: route.navLabel }).click();
    await expect(page).toHaveURL(new RegExp(`/${route.path}$`));
    await expect(page).not.toHaveURL(/#/);
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
  }

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Feeder" })).toBeVisible();
});

test("every route is reachable by a cold deep link", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
  }
});

test("primary nav items meet the minimum touch target size", async ({ page }) => {
  await page.goto("");
  const nav = page.getByRole("navigation", { name: "Primary" });
  const links = nav.getByRole("link");
  // locator.count() does not auto-wait like other Playwright assertions, so
  // wait for the shell to render before counting — otherwise this races the
  // app's async boot (main.tsx awaits the msw worker before first render).
  await expect(links).toHaveCount(6);
  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const box = await links.nth(i).boundingBox();
    expect(box).not.toBeNull();
    // WCAG 2.5.5 / the app's --touch-target token (48px) — critical for
    // WP-23's one-handed in-store mode.
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("skip link moves focus to the main content landmark", async ({ page }) => {
  await page.goto("");
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});
