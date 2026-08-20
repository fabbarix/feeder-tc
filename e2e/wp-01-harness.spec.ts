import { expect, test } from "@playwright/test";

// Trivial proof that the Playwright harness runs headless against the app,
// through hash routing and the /feeder-tc/ base path. Later WPs add real
// @e2e-tagged scenarios from IMPLEMENTATION_PLAN.md (see TESTING.md).
test("navigates from home to the pantry route via hash routing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Feeder" })).toBeVisible();

  await page.getByRole("link", { name: "Pantry" }).click();
  await expect(page).toHaveURL(/#\/pantry$/);
  await expect(page.getByRole("heading", { name: "Pantry" })).toBeVisible();
});
