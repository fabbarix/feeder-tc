import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// WP-VC ("visual conformance — make the app match the approved mock").
//
// The owner compared production against design/mock-screens.html (the
// approved mock) and said "not even close". Three confirmed defects, each
// caught by eye/screenshot rather than by any existing test — this spec
// pins the measurable symptom of each so none of them can regress silently
// again (see design/mock-reference.css for the mock's own extracted
// tokens/layout rules, copied verbatim, which is what every assertion here
// is checked against).

async function addRecipe(page: import("@playwright/test").Page, name: string, cookMinutes: number): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipes" }).click();
  await page.getByRole("link", { name: /Add recipe|New recipe/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Cook time (min)" }).fill(String(cookMinutes));
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
}

test.describe("full-width layout mode for grid/browse routes (design/mock-reference.css §2)", () => {
  test.use({ viewport: { width: 1677, height: 1000 } });

  // Owner-reported: every route was capped at the 840px reading measure,
  // including card grids — the mock's `.rgrid` is `repeat(auto-fill,
  // minmax(168px,1fr))` and reflows into as many columns as fit, but
  // production showed only two recipe cards on a 1677px viewport, with the
  // right half of the screen empty.
  test("the recipe grid is not capped at the 840px reading measure, and reflows into more than two columns", async ({
    page,
  }) => {
    await enterReadyShell(page, "recipes");
    for (const [name, cook] of [
      ["Chili", 25],
      ["Carbonara", 20],
      ["Roast chicken", 45],
    ] as const) {
      await addRecipe(page, name, cook);
    }

    const measure = page.locator("main > div").first();
    const box = await measure.boundingBox();
    expect(box).not.toBeNull();
    // Nowhere near the 840px prose measure — this route opted into the wide
    // layout mode (AppShell.tsx's WIDE_ROUTES).
    expect(box!.width).toBeGreaterThan(1200);

    const columnCount = await page.evaluate(() => {
      const grid = document.querySelector('[class*="grid"]');
      if (!grid) throw new Error("recipe grid not found");
      return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    });
    // The specific defect: production rendered exactly two columns at this
    // viewport width. `auto-fill`/`minmax(168px,1fr)` at ~1645px of usable
    // width fits well beyond four — assert generously above the reported
    // regression rather than pinning today's exact count.
    expect(columnCount).toBeGreaterThan(2);
  });

  test("the pantry route also gets the wide layout (main + rail, UI_DESIGN.md §13 'width buys information')", async ({
    page,
  }) => {
    await enterReadyShell(page, "pantry");
    const measure = page.locator("main > div").first();
    const box = await measure.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(1200);
  });

  // The ingredients catalog is a plain single-column list (ListRow), not a
  // grid — going wide would only stretch each row across empty trailing
  // space, which is padding, not information. It deliberately keeps the
  // narrow measure even though it is a sibling "browse" tab of /recipes.
  test("the ingredients catalog keeps the narrow reading measure (it is a list, not a grid)", async ({ page }) => {
    await enterReadyShell(page, "recipes/ingredients");
    const measure = page.locator("main > div").first();
    const box = await measure.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(841);
  });

  // A prose/detail/form route keeps the 840px measure even at this width —
  // the wide mode is opt-in per route, not a global default.
  test("a recipe's own editor page keeps the narrow reading measure", async ({ page }) => {
    await enterReadyShell(page, "recipes/new");
    const measure = page.locator("main > div").first();
    const box = await measure.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(841);
  });
});

test.describe("hue-derived surface tokens (design/mock-reference.css §1)", () => {
  // Owner-reported: "not even close" traced to flat hex neutrals
  // (--paper/--surface/--surface-2 as plain #rrggbb) where the mock derives
  // every surface from the accent hue in OKLCH — a small, deliberate
  // chroma that gives every card a subtle accent cast instead of reading as
  // grey slate. This pins the mechanism (an `oklch(... var(--accent-hue))`
  // function value), not literal numbers, so it survives a future hue or
  // lightness tweak as long as the derivation itself isn't reverted to a
  // flat hex.
  for (const [theme, colorScheme] of [
    ["light", "light"],
    ["dark", "dark"],
  ] as const) {
    test(`${theme} mode: --paper/--surface/--surface-2/--line resolve to hue-derived oklch(), not flat hex`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await enterReadyShell(page);
      const { hue, tokens } = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          hue: cs.getPropertyValue("--accent-hue").trim(),
          tokens: {
            paper: cs.getPropertyValue("--paper").trim(),
            surface: cs.getPropertyValue("--surface").trim(),
            surface2: cs.getPropertyValue("--surface-2").trim(),
            line: cs.getPropertyValue("--line").trim(),
          },
        };
      });
      // getComputedStyle resolves `var(--accent-hue)` to its number, so the
      // string itself never literally contains "var(...)" — assert the
      // FUNCTION form (oklch(), not a flat #rrggbb/rgb()) for all four, and
      // that the hue component matches the live --accent-hue for the three
      // that carry chroma (--surface is the mock's own `oklch(1 0 0)` —
      // pure white, chroma 0, deliberately hueless).
      for (const [name, value] of Object.entries(tokens)) {
        expect(value, `--${name} should be an oklch() colour, not a flat hex`).toMatch(/^oklch\(/);
        if (name !== "surface") {
          expect(value, `--${name} should carry the live --accent-hue (${hue})`).toContain(` ${hue})`);
        }
      }
    });
  }
});

test.describe("unstyled-link audit (owner-reported: the ingredients-catalog link had no className)", () => {
  test("the Recipes/Ingredients tab bar renders as a proper styled control, not a bare default-blue link", async ({
    page,
  }) => {
    await enterReadyShell(page, "recipes");
    const tabs = page.getByRole("navigation", { name: "Recipes section" });
    await expect(tabs).toBeVisible();
    const ingredientsTab = tabs.getByRole("link", { name: "Ingredients" });
    const color = await ingredientsTab.evaluate((el) => getComputedStyle(el).color);
    // Browser-default link blue is rgb(0, 0, 238); visited purple is
    // rgb(85, 26, 139). Neither should ever appear again.
    expect(color).not.toBe("rgb(0, 0, 238)");
    expect(color).not.toBe("rgb(85, 26, 139)");

    const recipesTab = tabs.getByRole("link", { name: "Recipes" });
    await expect(recipesTab).toHaveAttribute("aria-current", "page");
  });

  test("each ingredient row's name link inherits list text colour and carries no underline by default", async ({
    page,
  }) => {
    await enterReadyShell(page, "recipes/ingredients");
    const firstRow = page.locator('a[href^="/recipes/ingredients/"]:not([href$="/new"])').first();
    await expect(firstRow).toBeVisible();
    const [color, textDecoration] = await firstRow.evaluate((el) => [
      getComputedStyle(el).color,
      getComputedStyle(el).textDecorationLine,
    ]);
    expect(color).not.toBe("rgb(0, 0, 238)");
    expect(color).not.toBe("rgb(85, 26, 139)");
    expect(textDecoration).toBe("none");
  });

  test("the recipe and ingredient editors' back-links are styled, not browser-default blue", async ({ page }) => {
    await enterReadyShell(page, "recipes/new");
    const backLink = page.getByRole("link", { name: "← Recipes" });
    const color = await backLink.evaluate((el) => getComputedStyle(el).color);
    expect(color).not.toBe("rgb(0, 0, 238)");
    expect(color).not.toBe("rgb(85, 26, 139)");
  });
});
