import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { addRecipe } from "./support/recipes.ts";
import { E2E_CREATED_SPREADSHEET_ID, E2E_FAKE_ACCESS_TOKEN } from "../src/mocks/handlers.ts";

// WP-VC ("visual conformance — make the app match the approved mock").
//
// The owner compared production against design/mock-screens.html (the
// approved mock) and said "not even close". Three confirmed defects, each
// caught by eye/screenshot rather than by any existing test — this spec
// pins the measurable symptom of each so none of them can regress silently
// again (see design/mock-reference.css for the mock's own extracted
// tokens/layout rules, copied verbatim, which is what every assertion here
// is checked against).

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
  test("the ingredients catalog keeps the narrow reading measure (it is a list, not a grid)", async ({
    page,
  }) => {
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
          expect(value, `--${name} should carry the live --accent-hue (${hue})`).toContain(
            ` ${hue})`,
          );
        }
      }
    });
  }
});

test.describe("unstyled-link audit (owner-reported: the ingredients-catalog link had no className)", () => {
  // WP-VC4: this control used to be a pill `SegmentedControl`-look built on
  // `<NavLink aria-current>`; the owner asked for real tab headers instead
  // ("make the tab selectors look more like tab headers ... a visual clue
  // that that is a tab, just not a segmented selector"), so it is now a
  // proper `role="tablist"`/`"tab"` widget (RouteTabs.tsx) with
  // `aria-selected`, not `aria-current`/role "link".
  test("the Recipes/Ingredients tab bar renders as a real tablist, styled, not a bare default-blue link", async ({
    page,
  }) => {
    await enterReadyShell(page, "recipes");
    const tabs = page.getByRole("tablist", { name: "Recipes section" });
    await expect(tabs).toBeVisible();
    const ingredientsTab = tabs.getByRole("tab", { name: "Ingredients" });
    const color = await ingredientsTab.evaluate((el) => getComputedStyle(el).color);
    // Browser-default link blue is rgb(0, 0, 238); visited purple is
    // rgb(85, 26, 139). Neither should ever appear again.
    expect(color).not.toBe("rgb(0, 0, 238)");
    expect(color).not.toBe("rgb(85, 26, 139)");

    const recipesTab = tabs.getByRole("tab", { name: "Recipes" });
    await expect(recipesTab).toHaveAttribute("aria-selected", "true");
    await expect(ingredientsTab).toHaveAttribute("aria-selected", "false");
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

  // WP-VC4: the recipe editor's "← Recipes" breadcrumb is gone — Save/
  // Cancel moved into the top bar (design/mock-screens.html #editor's
  // `.dt-actions`), so "Cancel" is now the one link back out of this
  // screen, and it needs the same styled-not-browser-default-blue audit
  // the breadcrumb used to get.
  test("the recipe editor's Cancel link is styled, not browser-default blue", async ({ page }) => {
    await enterReadyShell(page, "recipes/new");
    const cancelLink = page.getByRole("link", { name: "Cancel" });
    const [color, textDecoration] = await cancelLink.evaluate((el) => [
      getComputedStyle(el).color,
      getComputedStyle(el).textDecorationLine,
    ]);
    expect(color).not.toBe("rgb(0, 0, 238)");
    expect(color).not.toBe("rgb(85, 26, 139)");
    expect(textDecoration).toBe("none");
  });
});

// WP-VC3 Task 1 pinned `border-radius: 999px` here (design/mock-screens.html's
// `.seg{...border-radius:999px...}`), replacing an earlier `--radius-md`
// (10px) rounded rect. UX review round 2 (Finding 1: narrow rails like
// Pantry's Location filter overflowed the page — SegmentedControl.module.css's
// old `flex: 1 1 auto` grew to fill a wide container but neither shrank nor
// wrapped in a narrow one) briefly dropped the pill everywhere, but that
// over-corrected: design/mock-screens.html draws the plain pill in all 28 of
// its own uses, and only `mock-responsive.html`'s "segmented control fix,
// made concrete" DEMO (4 uses, all inside the note explaining the fix)
// draws the rounded-rect `.seg.wrap` shape. Owner's decision: pill by
// default, everywhere — a control that never wraps has no reason to give it
// up — and the rounded-rect radius is an explicit opt-in (`wraps` prop,
// SegmentedControl.tsx) for a control that actually wraps onto a second row
// at a supported width, because a fully-rounded pill that wraps to two rows
// reads as a blob, not a control. This spec pins BOTH shapes so neither can
// drift: the two representative consumers below never wrap (their
// containers are wide enough for their option counts) and stay the 999px
// pill; the case after it pins the one consumer that does wrap.
test.describe("SegmentedControl is a 999px pill by default, --radius-md/--radius-sm only where it wraps (UX review round 2 / owner decision)", () => {
  test("the theme control (Settings 'Appearance') renders both the trough and the selected segment as a 999px pill", async ({
    page,
  }) => {
    await enterReadyShell(page, "settings");
    const group = page.getByRole("radiogroup", { name: "Appearance" });
    await expect(group).toBeVisible();
    const groupRadius = await group.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(groupRadius).toBe("999px");

    const selected = page.getByRole("radio", { checked: true }).first();
    const segmentRadius = await selected.evaluate(
      (el) => getComputedStyle(el.closest("label")!).borderRadius,
    );
    expect(segmentRadius).toBe("999px");
  });

  test("a recipe's household-flag control (RecipeDetail read view) is also a 999px pill", async ({
    page,
  }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Pill Shape Test", 15);
    await page.getByRole("link", { name: "Pill Shape Test" }).click();

    const group = page.getByRole("radiogroup", { name: "Use in planning" });
    await expect(group).toBeVisible();
    const groupRadius = await group.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(groupRadius).toBe("999px");
  });

  // The one consumer that actually wraps: Pantry's Location filter in its
  // 250px desktop rail (pantry.module.css `.rail`) — 4 segments at ≥72px
  // each need ≥298px including gaps/padding, more than the rail leaves, so
  // it drops onto two rows and opts into `wraps` (Pantry.tsx). Pinning both
  // this shape and the pill shape above means neither can silently drift: a
  // future change that makes this wrap-in-fact but keeps the pill radius,
  // or that keeps it non-wrapping but drops the radius anyway, fails here.
  // Scoped to its own block so the viewport override below applies ONLY to
  // this case. Applying it to the whole describe would also pin the two pill
  // assertions above to 1280px — and those specifically need to keep running
  // at each project's own viewport, including mobile-chrome's phone width,
  // because a narrow viewport is exactly where a control could start wrapping
  // and turn its pill into a blob. That is the regression they exist to catch.
  test.describe("the wrapping case", () => {
    // Pantry's FILTERS rail is `display: none` below 768px (pantry.module.css),
    // so mobile-chrome would otherwise find no visible rail at all — same
    // "desktop-only rail" reasoning as the WP-VC4 block further down.
    test.use({ viewport: { width: 1280, height: 900 } });

    test("Pantry's Location filter (250px desktop rail) is a --radius-md rounded rect, not a pill, because it wraps", async ({
      page,
    }) => {
      await enterReadyShell(page, "pantry");
      const rail = page.locator('[class*="rail"]');
      const group = rail.getByRole("radiogroup", { name: "Location" });
      await expect(group).toBeVisible();
      const groupRadius = await group.evaluate((el) => getComputedStyle(el).borderRadius);
      expect(groupRadius).toBe("10px"); // --radius-md

      const selected = group.getByRole("radio", { checked: true }).first();
      const segmentRadius = await selected.evaluate(
        (el) => getComputedStyle(el.closest("label")!).borderRadius,
      );
      expect(segmentRadius).toBe("6px"); // --radius-sm
    });
  });
});

// WP-VC3 ("final conformance pass"): Plan and Shopping were previously
// verified by screenshot only (both WP-22's and WP-23's own handover reports
// said so) — the weaker method the rest of this file's discipline exists to
// replace. Everything below asserts a measured number (boundingBox()/
// getComputedStyle), never a screenshot.

/**
 * Seeds a recipe needing 400 g of rice (the seed catalog's "dry-goods"-
 * category rice — src/data/seed-catalog.ts) and a plan slot for it this
 * week, through the real `WorkbookStore` contract — same technique as
 * e2e/wp-23-shopping-trip.spec.ts's `seedRicePlanForThisWeek` (see that
 * file's doc comment for why this runs inside `page.evaluate` rather than
 * through a UI that may not be mounted yet). Trimmed to just what the
 * CheckRow-geometry test below needs: one populated shopping-list line to
 * measure, in a category the catalog actually assigns (so the same seed
 * doubles as a live check that WP-VC3's category grouping produces a real
 * subheading, not just an empty-list layout check).
 */
async function seedRicePlanForThisWeek(page: Page): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const domainPath = "/src/domain/index.ts";
      const rangePath = "/src/routes/shopping/range.ts";
      const sheets = await import(sheetsPath);
      const domain = await import(domainPath);
      const rangeHelpers = await import(rangePath);

      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      const rng = domain.createSeededRng(1);

      const recipeId = domain.newRecipeId(rng);
      await store.recipes.upsert({
        id: recipeId,
        name: "E2E rice dinner",
        kind: "cooked",
        baseServings: 2,
        prepMinutes: 5,
        cookMinutes: 20,
        mealTags: ["dinner"],
        status: "in-rotation",
      });
      await store.recipeIngredients.replaceForRecipe(recipeId, [
        {
          recipeId,
          ingredientId: domain.makeIngredientId("rice"),
          quantity: { amount: 400, unit: "g" },
        },
      ]);

      const monday = rangeHelpers.mondayOnOrBefore(domain.systemClock.today());
      await store.planSlots.upsert({
        id: domain.newPlanSlotId(rng),
        date: monday,
        slotType: "dinner",
        slotIndex: 0,
        filling: { kind: "recipe", recipeId },
        state: "planned",
        pinned: false,
      });
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID },
  );
}

test.describe("Plan and Shopping — full-width layout (design/mock-reference.css §2)", () => {
  test.use({ viewport: { width: 1677, height: 1000 } });

  // Both are in AppShell.tsx's WIDE_ROUTES alongside /recipes and /pantry
  // (which the describe block above already covers) — this closes the gap
  // WP-VC/WP-VC2 left: neither was measured, only screenshotted.
  test("the Plan route is not capped at the 840px reading measure", async ({ page }) => {
    await enterReadyShell(page, "plan");
    const measure = page.locator("main > div").first();
    const box = await measure.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(1200);
  });

  test("the Shopping route is not capped at the 840px reading measure", async ({ page }) => {
    await enterReadyShell(page, "shopping");
    const measure = page.locator("main > div").first();
    const box = await measure.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(1200);
  });

  // UI_DESIGN.md §13 Desktop: "the week planner is the screen that justifies
  // desktop: seven columns, whole week visible" — plan.module.css's `.week`
  // is `grid-template-columns: repeat(7, minmax(0,1fr))` at >=768px. Pinning
  // the literal column count, not just "wider than 1200px", is what makes
  // this test fail if a future change collapses the grid to fewer/more
  // columns while still happening to measure wide.
  test("the week planner's desktop grid renders exactly seven columns, one per day", async ({
    page,
  }) => {
    await enterReadyShell(page, "plan");
    await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
    // Plan.tsx renders its own Skeletons while `usePlanWeek` boots (and, as
    // of WP-VC3, the route itself is a lazily-fetched chunk) — wait for the
    // real week grid rather than racing either of those.
    const grid = page.locator('main [class*="week"]').first();
    await expect(grid).toBeVisible();
    const columnCount = await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(columnCount).toBe(7);
  });
});

test.describe("hue-derived surface tokens on Plan/Shopping (design/mock-reference.css §1)", () => {
  // The describe block near the top of this file already proves the
  // MECHANISM (oklch() tied to --accent-hue) holds on Home. This extends the
  // same measured check to the two routes WP-VC3 is specifically closing the
  // gap on, guarding against a future route-scoped regression (e.g. a
  // route's own CSS module accidentally reintroducing a flat hex surface)
  // that a Home-only check would never catch.
  for (const routePath of ["plan", "shopping"] as const) {
    test(`${routePath}: --paper/--surface/--surface-2/--line resolve to hue-derived oklch(), not flat hex`, async ({
      page,
    }) => {
      await enterReadyShell(page, routePath);
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
      for (const [name, value] of Object.entries(tokens)) {
        expect(value, `--${name} should be an oklch() colour, not a flat hex`).toMatch(/^oklch\(/);
        if (name !== "surface") {
          expect(value, `--${name} should carry the live --accent-hue (${hue})`).toContain(
            ` ${hue})`,
          );
        }
      }
    });
  }
});

test.describe("CheckRow measured geometry on Shopping (UI_DESIGN.md §6 'the WHOLE row is the tap target')", () => {
  test("a populated shopping CheckRow measures the 56px in-store touch target and a 24px check box — not screenshot-only", async ({
    page,
  }) => {
    await enterReadyShell(page);
    await seedRicePlanForThisWeek(page);
    await page.getByRole("link", { name: "Shopping", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();

    const riceCheckbox = page.getByRole("checkbox", { name: /rice/i });
    await expect(riceCheckbox).toBeVisible();
    // CheckRow.tsx renders one <label> wrapping the whole row — box, hidden
    // checkbox input, text and trailing quantity all inside it — so the
    // label IS the tap target this test measures.
    const row = riceCheckbox.locator("xpath=ancestor::label[1]");

    // CheckRow.module.css: min-height: calc(var(--touch-target) + var(--space-2))
    // = 48px + 8px = 56px — bigger than ListRow's plain 48px --touch-target,
    // matching UI_DESIGN.md §6's "in-store variant; larger" than ListRow.
    const minHeight = await row.evaluate((el) => getComputedStyle(el).minHeight);
    expect(minHeight).toBe("56px");
    const rowBox = await row.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.height).toBeGreaterThanOrEqual(56);

    // The decorative check box (CheckRow.module.css's `.box`) is a fixed
    // 24x24px square — first() picks the outer <span class="...box..."> over
    // its own nested .boxSvg/.boxRect/.boxCheck descendants (whose class
    // names also contain the substring "box"), since querySelectorAll's
    // document order lists an ancestor before its own descendants.
    const checkBox = row.locator('[class*="box"]').first();
    const checkBoxBox = await checkBox.boundingBox();
    expect(checkBoxBox).not.toBeNull();
    expect(checkBoxBox!.width).toBeCloseTo(24, 0);
    expect(checkBoxBox!.height).toBeCloseTo(24, 0);

    // WP-VC3's shopping category-subheading contract change, exercised
    // live: the seeded rice line is catalog-categorised "dry-goods"
    // (src/data/seed-catalog.ts), so "To buy" renders under a "Dry goods"
    // subheading rather than one flat list (design/mock-screens.html
    // #shopping's `.rowgroup`s).
    await expect(page.getByRole("heading", { name: "Dry goods" })).toBeVisible();
  });
});

// WP-VC4 ("structural rework"): the owner's complaint this time was
// structure, not colour — screenshots hide structural bugs, which is
// exactly how the pantry shipped as one row per LOT (with a wall of
// buttons on every row) instead of one row per ingredient. These pin the
// DOM shape itself: element counts and roles, not just measured pixels.
test.describe("WP-VC4 structural conformance", () => {
  // The FILTERS rail (like the old "At a glance" rail it replaced) is
  // desktop-only — `.rail{display:none}` below 768px (pantry.module.css) —
  // so this whole block runs at a desktop viewport, same pattern as the
  // other desktop-specific describe blocks in this file.
  test.use({ viewport: { width: 1280, height: 900 } });

  async function addRiceLot(page: Page, amount: string): Promise<void> {
    await page.getByRole("button", { name: "Add to pantry" }).click();
    await page.getByRole("button", { name: /ingredient/i }).click();
    await page.getByRole("option", { name: "Rice", exact: true }).click();
    await page.getByRole("textbox", { name: /amount/i }).fill(amount);
    await page.getByRole("button", { name: "Add to pantry" }).click();
  }

  test("a pantry with two lots of one ingredient renders exactly one row, and that row links to the detail route", async ({
    page,
  }) => {
    await enterReadyShell(page, "pantry");
    await addRiceLot(page, "600");
    await addRiceLot(page, "400");

    // Exactly one row for Rice — aggregated, not one per lot (the old
    // defect: `group.lots.map(renderRow)` rendered two near-identical rows
    // for this exact scenario, each with its own four action buttons).
    const riceRow = page.getByRole("link", { name: /Rice/ });
    await expect(riceRow).toHaveCount(1);
    await expect(page.getByRole("main")).toContainText("1000 g");
    await expect(page.getByRole("main")).toContainText("2 lots, FIFO");

    // No per-lot action buttons on the list page any more (WP-VC4 moved
    // them to the detail route) — this used to render "Open"/"Move"/
    // "Spoil"/"Correct" once per lot, i.e. twice each for this scenario.
    await expect(page.getByRole("button", { name: "Move" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Spoil" })).toHaveCount(0);

    // ...and the row is a real link to `/pantry/:ingredientId`, matching
    // the mock's pantry-item screen (design/mock-screens.html #lot).
    await riceRow.click();
    await expect(page.getByRole("heading", { name: "Rice", level: 1 })).toBeVisible();
    // The card head is a plain styled div, same "eyebrow label, not a
    // heading" convention as every other `.sectionCardHead` in the app
    // (forms.module.css — RecipeEditor's "Identity"/"Steps" card heads are
    // the same non-heading shape), so this checks visible text, not role.
    await expect(page.getByText("Lots · FIFO order", { exact: true })).toBeVisible();
    // Both lots now show up individually on the detail page.
    await expect(page.getByRole("main")).toContainText("600 g");
    await expect(page.getByRole("main")).toContainText("400 g");
  });

  test("the pantry list's rail is FILTERS (location + show chips), not an AT A GLANCE count-only rail", async ({
    page,
  }) => {
    await enterReadyShell(page, "pantry");
    await addRiceLot(page, "500");
    await expect(page.getByText("Filters", { exact: true })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Location" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Show" })).toBeVisible();
    await expect(page.getByText("At a glance", { exact: true })).toHaveCount(0);
  });

  test("a recipe card's meta line (prep/cook/serves) renders on one line, not wrapped", async ({ page }) => {
    await enterReadyShell(page, "recipes");
    await addRecipe(page, "Meta Line Test", 20);
    const card = page.getByRole("link", { name: /Meta Line Test/ });
    const metaSpans = card.locator('[class*="cardMeta"] > span');
    await expect(metaSpans).toHaveCount(3);
    const tops = await metaSpans.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    // All three spans share the same top edge — if the flex row had
    // wrapped to two lines (the reported defect), the wrapped span(s)
    // would sit at a different `top`.
    expect(new Set(tops).size).toBe(1);
  });

  test("the Recipes tab strip exposes role=tablist/tab, and there is exactly one h1 naming the area", async ({
    page,
  }) => {
    await enterReadyShell(page, "recipes");
    await expect(page.getByRole("tablist", { name: "Recipes section" })).toBeVisible();
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(2);
    // One h1 for the whole area (owner-reported: "the repetition of
    // 'Recipes' at the top and 'Ingredients' is a waste of space") — the
    // tab strip is the section header now, so the h1 doesn't re-name the
    // active tab.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    await page.getByRole("tab", { name: "Ingredients" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recipes");
  });
});
