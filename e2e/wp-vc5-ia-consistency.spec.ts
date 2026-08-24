import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { addRecipe } from "./support/recipes.ts";
import { goToIngredients } from "./support/ingredients.ts";

// WP-VC5 ("consistency and information-architecture defect sweep").
//
// The owner found five defects within minutes of opening the app, after six
// rounds of agent review missed every one — because every review walked one
// screen at a time instead of comparing the same PATTERN (every header,
// every search field, every primary action) across screens. These tests
// pin the invariant each fix establishes, not the specific screen it was
// first noticed on, so a future sixth screen that violates the same
// invariant fails here too.

test.describe("primary create action: one placement, one naming pattern", () => {
  test('"New recipe" never appears anywhere — "Add recipe" is the only label used', async ({ page }) => {
    await enterReadyShell(page, "recipes");
    await expect(page.getByText("New recipe", { exact: true })).toHaveCount(0);
    // Recipes.tsx used to say "New recipe" in its header and "Add recipe" in
    // its own EmptyState in the SAME file — the exact inconsistency this
    // sweep was named for.
    await expect(page.getByRole("link", { name: "Add recipe", exact: true }).first()).toBeVisible();
  });

  test("Recipes and Ingredients render their primary action above the tab strip, styled identically", async ({
    page,
  }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Consistency Check", 10);

    const recipesAction = page.getByRole("link", { name: "Add recipe", exact: true });
    const recipesTabs = page.getByRole("tablist", { name: "Recipes section" });
    await expect(recipesAction).toBeVisible();
    const recipesActionBox = await recipesAction.boundingBox();
    const recipesTabsBox = await recipesTabs.boundingBox();
    expect(recipesActionBox).not.toBeNull();
    expect(recipesTabsBox).not.toBeNull();
    // Above the tab strip, not buried inside one tab's own panel below it
    // (Ingredients.tsx used to render "Add ingredient" AFTER its search
    // field, inside the tabpanel) — same placement Recipes.tsx always used.
    expect(recipesActionBox!.y).toBeLessThan(recipesTabsBox!.y);
    const recipesClass = await recipesAction.evaluate((el) => el.className);

    await page.getByRole("tab", { name: "Ingredients" }).click();
    const ingredientsAction = page.getByRole("link", { name: "Add ingredient", exact: true });
    const ingredientsTabs = page.getByRole("tablist", { name: "Recipes section" });
    await expect(ingredientsAction).toBeVisible();
    const ingredientsActionBox = await ingredientsAction.boundingBox();
    const ingredientsTabsBox = await ingredientsTabs.boundingBox();
    expect(ingredientsActionBox).not.toBeNull();
    expect(ingredientsTabsBox).not.toBeNull();
    expect(ingredientsActionBox!.y).toBeLessThan(ingredientsTabsBox!.y);
    const ingredientsClass = await ingredientsAction.evaluate((el) => el.className);

    // Same shared `forms.addButton` class on both — one button style for
    // the primary create action across sibling tabs, not two that happen
    // to resemble each other.
    expect(ingredientsClass).toBe(recipesClass);
  });

  test("Products' primary action (Scan a barcode) shares the same header-row placement and button style", async ({
    page,
  }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Consistency Check 2", 10);
    const recipesAction = page.getByRole("link", { name: "Add recipe", exact: true });
    const recipesClass = await recipesAction.evaluate((el) => el.className);

    await page.getByRole("tab", { name: "Products" }).click();
    const productsAction = page.getByRole("link", { name: "Scan a barcode", exact: true });
    const productsTabs = page.getByRole("tablist", { name: "Recipes section" });
    await expect(productsAction).toBeVisible();
    const productsActionBox = await productsAction.boundingBox();
    const productsTabsBox = await productsTabs.boundingBox();
    expect(productsActionBox).not.toBeNull();
    expect(productsTabsBox).not.toBeNull();
    expect(productsActionBox!.y).toBeLessThan(productsTabsBox!.y);
    const productsClass = await productsAction.evaluate((el) => el.className);
    // Products has no manual "create" form (a product only ever comes from
    // scanning a barcode), so the verb is deliberately different — but the
    // control is still the app's one shared button style, not a bespoke
    // look for this one screen.
    expect(productsClass).toBe(recipesClass);
  });
});

test.describe("page heading never visibly duplicates the selected nav item", () => {
  const ROUTES: readonly { readonly path: string; readonly name: string }[] = [
    { path: "pantry", name: "Pantry" },
    { path: "shopping", name: "Shopping" },
    { path: "plan", name: "Plan" },
    { path: "settings", name: "Settings" },
    { path: "recipes", name: "Recipes" },
    { path: "recipes/ingredients", name: "Recipes" },
    { path: "products", name: "Recipes" },
  ];

  for (const { path, name } of ROUTES) {
    test(`/${path}: exactly one h1, present for a screen reader, not repeated on screen`, async ({ page }) => {
      await enterReadyShell(page, path);
      const heading = page.getByRole("heading", { level: 1 });
      // Exactly one accessible h1 per page (protects the same real
      // screen-reader behaviour wp-vc-visual-conformance.spec.ts's
      // Recipes-specific version of this check already pins) — never zero
      // (an app that deletes the heading to "fix" the duplication) and
      // never more than one.
      await expect(heading).toHaveCount(1);
      await expect(heading).toHaveText(name);
      // The nav already shows this exact label as the selected item, so the
      // h1 must not ALSO occupy real on-screen space repeating it — the
      // visually-hidden technique (1x1px, clipped) is the one this app uses
      // elsewhere (EntityTable's `hideCaption`, AppShell's account-menu
      // label) for "accessible name only, nothing to add on screen".
      const box = await heading.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(1);
      expect(box!.height).toBeLessThanOrEqual(1);
    });
  }

  test("the selected nav item's own label is the only on-screen copy of that word at the top of the page", async ({
    page,
  }) => {
    await enterReadyShell(page, "pantry");
    // The nav link itself is the one visible "Pantry" — not a second,
    // full-size on-screen copy directly below it (the literal defect: "with
    // Pantry selected in the nav, the page also says Pantry").
    const navPantry = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Pantry", exact: true });
    await expect(navPantry).toBeVisible();
    const visibleHeadingText = await page.locator("main h1, section h1").evaluateAll((els) =>
      els
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        })
        .map((el) => el.textContent),
    );
    expect(visibleHeadingText).toHaveLength(0);
  });
});

test.describe("search fields share one component", () => {
  test("Recipes, Ingredients and Products render the same search-field markup", async ({ page }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Search Field Check", 10);

    const recipesSearch = page.getByRole("textbox", { name: "Search recipes" });
    await expect(recipesSearch).toBeVisible();
    const recipesWrapperClass = await recipesSearch.evaluate((el) => el.parentElement?.className);

    await goToIngredients(page);
    const ingredientsSearch = page.getByRole("textbox", { name: "Search ingredients" });
    await expect(ingredientsSearch).toBeVisible();
    const ingredientsWrapperClass = await ingredientsSearch.evaluate((el) => el.parentElement?.className);

    await page.getByRole("tab", { name: "Products" }).click();
    const productsSearch = page.getByRole("textbox", { name: "Search products" });
    await expect(productsSearch).toBeVisible();
    const productsWrapperClass = await productsSearch.evaluate((el) => el.parentElement?.className);

    // One `SearchField` component (src/ui/components/SearchField.tsx), not
    // three inputs that happen to look similar — same wrapper class on all
    // three routes.
    expect(ingredientsWrapperClass).toBe(recipesWrapperClass);
    expect(productsWrapperClass).toBe(recipesWrapperClass);
  });
});

test.describe("recipe-card metadata: icons, not spelled-out words, still fully announced", () => {
  test('a recipe card never spells out "prep"/"cook"/"serves" on screen, but each value is announced in full', async ({
    page,
  }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Icon Meta Check", 25);
    const card = page.getByRole("link", { name: /Icon Meta Check/ });
    await expect(card).toBeVisible();

    // The visible card never spells the words out — only an icon + a short
    // value ("25m") sits on screen, aria-hidden from the accessibility
    // tree.
    await expect(card.getByText("prep", { exact: false })).toHaveCount(0);
    await expect(card.getByText("cook", { exact: false })).toHaveCount(0);
    await expect(card.getByText("serves", { exact: false })).toHaveCount(0);

    // Each value is still announced in full to a screen reader — an
    // `aria-label` on the wrapping element, not left to a bare "25m" (which
    // doesn't say whether that's prep or cook) or to the icon alone.
    const metaSpans = card.locator('[class*="cardMeta"] > span');
    const labels = await metaSpans.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(labels).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Prep \d+ minutes$/), expect.stringMatching(/^Cook 25 minutes$/), expect.stringMatching(/^Serves \d+$/)]),
    );
  });
});
