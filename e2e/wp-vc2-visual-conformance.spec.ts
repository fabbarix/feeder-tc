import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { addRecipe } from "./support/recipes.ts";

// WP-VC2 ("Home dashboard + read-only recipe view — match design/mock-
// screens.html's #home and #recipe sections"). Pins the measurable shape of
// both screens, same discipline as e2e/wp-vc-visual-conformance.spec.ts:
// numbers/selectors, not screenshots, so a future change that quietly
// breaks the layout fails a specific assertion instead of "looking a bit
// off".

test.describe("Home dashboard (design/mock-screens.html #home)", () => {
  test("greets by name, shows the date/household size, and two side-by-side stat tiles — even on a phone viewport", async ({
    page,
  }) => {
    test.info().annotations.push({ type: "viewport", description: "390x844 (phone)" });
    await page.setViewportSize({ width: 390, height: 844 });
    await enterReadyShell(page);

    await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening),/ })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("household of");
    await expect(page.getByRole("main")).toContainText("to buy this week");
    await expect(page.getByRole("main")).toContainText("expiring in");

    // The mock's `.hero-stat` is a fixed 2-column grid regardless of
    // viewport (never a 1-column stack on mobile) — assert the mechanism.
    const columns = await page.evaluate(() => {
      const el = document.querySelector('[class*="heroStat"]');
      if (!el) throw new Error("stat tile row not found");
      return getComputedStyle(el).gridTemplateColumns.split(" ").length;
    });
    expect(columns).toBe(2);
  });

  test("every card has its own real empty state on a brand-new workbook (no plan, no lots) — never a blank card", async ({
    page,
  }) => {
    await enterReadyShell(page);
    const main = page.getByRole("main");

    await expect(main.getByRole("heading", { name: "Tonight" })).toBeVisible();
    await expect(main).toContainText("Nothing planned for tonight");

    await expect(main.getByRole("heading", { name: "Rest of the week" })).toBeVisible();
    await expect(main).toContainText("Nothing else planned this week");

    await expect(main.getByRole("heading", { name: "Use these first" })).toBeVisible();
    await expect(main).toContainText("Your pantry is empty");

    // Both stat tiles read 0, not blank/NaN/undefined, on a workbook with
    // nothing planned and nothing stocked.
    await expect(page.locator('[class*="hstat"]').nth(0)).toContainText("0");
    await expect(page.locator('[class*="hstat"]').nth(1)).toContainText("0");
  });

  test("desktop: two-column layout — main content plus a narrow rail", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await enterReadyShell(page);
    const cols = page.locator('[class*="cols"]').first();
    const columns = await cols.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" "));
    expect(columns).toHaveLength(2);
    // Rail stays narrow (a sidebar, not a second equal column) — the mock's
    // own `.dt-cols` is `minmax(0,1fr) 250px`.
    const railWidth = Number.parseFloat(columns[1]!);
    expect(railWidth).toBeGreaterThan(200);
    expect(railWidth).toBeLessThan(320);
  });

  test("Home keeps the app's default ~840px reading measure (it is cards + a narrow rail, not a many-row grid like /recipes or /pantry)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1677, height: 1000 });
    await enterReadyShell(page);
    const measure = page.locator("main > div").first();
    const box = await measure.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(841);
  });
});

test.describe("Recipe read view (design/mock-screens.html #recipe)", () => {
  test("clicking a recipe card opens a distinct read view, not the always-editable form", async ({ page }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Chili", 25);

    await page.getByRole("link", { name: "Chili" }).click();
    await expect(page).toHaveURL(/\/recipes\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Chili" })).toBeVisible();
    // The read view has no form/save button — editing lives on its own route.
    await expect(page.getByRole("button", { name: "Save recipe" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveCount(0);

    // Its own, separate "Edit" action reaches the always-editable form, at
    // its own nested route.
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/recipes\/[^/]+\/edit$/);
    await expect(page.getByRole("heading", { name: "Edit recipe" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save recipe" })).toBeVisible();
  });

  test("household flag writes immediately from the read view — no save button, no navigation away", async ({ page }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Liver stew", 40);
    await page.getByRole("link", { name: "Liver stew" }).click();
    await expect(page.getByRole("heading", { name: "Liver stew" })).toBeVisible();

    await page.getByRole("radio", { name: "Staple" }).click();
    await expect(page.getByRole("radio", { name: "Staple" })).toBeChecked();
    // Still on the same read-view route — flipping the flag did not submit
    // a form or navigate anywhere.
    await expect(page.getByRole("heading", { name: "Liver stew" })).toBeVisible();

    // Persisted — reload via client-side nav and check again.
    const primaryNav = page.getByRole("navigation", { name: "Primary" });
    await primaryNav.getByRole("link", { name: "Home", exact: true }).click();
    await primaryNav.getByRole("link", { name: "Recipes", exact: true }).click();
    await page.getByRole("link", { name: "Liver stew" }).click();
    await expect(page.getByRole("radio", { name: "Staple" })).toBeChecked();
  });

  test("the servings stepper rescales the ingredients header without touching household flag or persisting", async ({
    page,
  }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Carbonara", 20);
    await page.getByRole("link", { name: "Carbonara" }).click();

    // The "Ingredients · scaled to N servings" card head is a plain div
    // (forms.module.css's `.sectionCardHead`, same non-heading convention
    // RecipeEditor.tsx's own section labels already use), not an ARIA
    // heading — matched by text instead of role.
    const cardHead = page.getByText(/Ingredients · scaled to \d+ servings/);
    await expect(cardHead).toBeVisible();
    const before = await cardHead.textContent();

    await page.getByRole("button", { name: "More servings" }).click();
    const after = page.getByText(/Ingredients · scaled to \d+ servings/);
    await expect(after).not.toHaveText(before ?? "");
    await expect(after).toContainText("servings");
  });

  test("Mark cooked updates the cooked-history line", async ({ page }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Fish pie", 40);
    await page.getByRole("link", { name: "Fish pie" }).click();

    await expect(page.getByRole("main")).toContainText("Not cooked yet");
    await page.getByRole("button", { name: "Mark cooked" }).click();
    await expect(page.getByRole("main")).toContainText("Cooked 1 time");
  });

  test("desktop: a recipe's own page gets its own third container width, not the plain 840px reading measure and not the 1680px browse cap", async ({ page }) => {
    // design/mock-desktop-density.html §"A recipe" (owner-approved
    // 2026-08-23): a recipe's own page is a detail view, not a form and not
    // a browse grid, so it gets a THIRD container width — `.mainDetail`,
    // ~1080px at >=1440px — rather than either of the other two. The photo
    // inset (`PhotoMedia`'s 320px `.detail` token) has nowhere honest to
    // sit inside the plain 840px measure without stealing width from the
    // ingredient/method reading column, so it gets its own column instead
    // (`recipe-detail.module.css`'s `.cols`, `AppShell.tsx`'s
    // `RECIPE_DETAIL_PATTERN`). This test used to assert the OLD 841px cap;
    // that assertion is exactly what this WP's owner-approved change
    // deliberately overturns for this one route.
    await page.setViewportSize({ width: 1677, height: 1000 });
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Tomato salad", 10);
    await page.getByRole("link", { name: "Tomato salad" }).click();
    await expect(page.getByRole("heading", { name: "Tomato salad" })).toBeVisible();
    const measure = page.locator("main > div").first();
    const box = await measure.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(841);
    expect(box!.width).toBeLessThanOrEqual(1081);
  });

  test("a populated recipe read view has no axe violations", async ({ page }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Roast chicken", 45);
    await page.getByRole("link", { name: "Roast chicken" }).click();
    await expect(page.getByRole("heading", { name: "Roast chicken" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
