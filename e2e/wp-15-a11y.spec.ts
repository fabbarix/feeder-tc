import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// WP-15 success criterion: "Axe (a11y) checks pass on shell and kit
// stories." This spec covers the shell half (the live app, every stub
// route, via a real Chromium — including `mobile-chrome`); the kit half
// (individual component a11y) is covered by `vitest-axe` in each
// component's co-located `*.test.tsx` (see TESTING.md "Accessibility
// checks"). A later WP adding a new route should add its path here too.
const ROUTES = ["", "recipes", "recipes/12", "pantry", "plan", "shopping", "settings"];

for (const route of ROUTES) {
  test(`route "/${route}" has no axe violations`, async ({ page }) => {
    await page.goto(route);
    // The app boots asynchronously (src/main.tsx awaits the msw browser
    // worker before the first React render), so scanning immediately after
    // goto() can catch an empty <div id="root">. Wait for the shell to be
    // painted first.
    await expect(page.getByRole("main")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}
