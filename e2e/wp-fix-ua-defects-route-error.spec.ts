import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// UA review finding #1: a bad URL used to replace the WHOLE app with React
// Router's own default error page — no header, no nav, no way back,
// addressed to "developer" ("💿 Hey developer 👋..."). This asserts what a
// USER would notice, not that a particular component mounted: the primary
// nav (and the shell chrome around it) survives a bad URL, framework/default
// text never reaches the screen, and there is a plain-language, human way
// back. Fails on `origin/main` (a367ab3) because that build has no
// `errorElement`/catch-all route at all — React Router's default
// `ErrorBoundary` takes over the whole document.
test("a bad URL keeps the shell and nav, and says the page doesn't exist in plain language", async ({ page }) => {
  await enterReadyShell(page, "definitely-not-a-route");

  // The shell survives: header, brand and primary nav are all still there —
  // this is the part `main`'s build fails outright (no header at all).
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();

  // Plain, human copy — not React Router's own default text, and not
  // addressed to a developer.
  await expect(page.getByText("That page doesn't exist")).toBeVisible();
  await expect(page.getByText(/hey developer/i)).toHaveCount(0);
  await expect(page.getByText(/Unexpected Application Error/i)).toHaveCount(0);
  await expect(page.getByText(/404 Not Found/i)).toHaveCount(0);

  // A way back that isn't just "click a nav item you already have" —
  // an explicit link off the error panel itself.
  const home = page.getByRole("link", { name: "Go to Feeder home" });
  await expect(home).toBeVisible();
  await home.click();
  await expect(page).toHaveURL(/\/$/);
});

test("a bad URL while signed out shows the normal sign-in gate, not a crash", async ({ page }) => {
  // Cold deep link, never signed in this session (WP-15's own gating
  // convention — see wp-15-shell-gating.spec.ts) — the app must not crash
  // before auth even resolves.
  await page.goto("definitely-not-a-route-either");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByText(/hey developer/i)).toHaveCount(0);
});
