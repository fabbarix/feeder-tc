import { expect, test } from "@playwright/test";

// UI_DESIGN.md §12 (product-owner requirement, folded into WP-15b):
// "when signed out, show only the login button — no menu items" — and a
// cold deep link must be gated too, not just the nav links. Each Playwright
// test gets its own fresh browser context — and WP-20 wired the real
// (msw-mocked) `createGoogleAuth`, whose access token deliberately lives
// only in memory, never persisted — so a bare goto() is always "signed out".
test("a cold deep link to /pantry while signed out shows the sign-in screen, not pantry content or nav", async ({
  page,
}) => {
  // Relative path per TESTING.md — a leading slash would resolve against
  // the origin and drop the base path.
  await page.goto("pantry");

  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).not.toBeVisible();
  // No nav links at all — the only link on this screen is the always-present
  // skip-link, not a menu item.
  await expect(page.getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pantry" })).not.toBeVisible();
  // The pantry stub's own heading must not have rendered behind the gate.
  await expect(page.getByRole("heading", { name: "Pantry" })).not.toBeVisible();
});

test("a cold deep link to /shopping while signed out shows the sign-in screen", async ({ page }) => {
  await page.goto("shopping");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shopping" })).not.toBeVisible();
});

test("signing in without a workbook shows create/open actions, still no nav or route content", async ({ page }) => {
  await page.goto("plan");
  await page.getByRole("button", { name: "Sign in with Google" }).click();

  await expect(page.getByRole("button", { name: "Create new meal planner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open existing…" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan" })).not.toBeVisible();
});

test("creating a workbook reveals the nav and the originally-requested route", async ({ page }) => {
  await page.goto("pantry");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await page.getByRole("button", { name: "Create new meal planner" }).click();

  // Bootstrap writes nine sheet headers plus the ~100-row seeded ingredient
  // catalog sequentially (src/sheets/bootstrap.ts) — allow more than the
  // default 5s.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({ timeout: 20_000 });
});

test("signing out from the ready state re-gates the app", async ({ page }) => {
  await page.goto("");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await page.getByRole("button", { name: "Create new meal planner" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({ timeout: 20_000 });

  // Sign-out lives in the avatar's account menu, not a standalone header
  // button (UI_DESIGN.md §12/§13, owner-reported 2026-08-20).
  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("button", { name: /^sign out$/i }).click();

  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).not.toBeVisible();
});
