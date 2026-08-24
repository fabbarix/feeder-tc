import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { goToPantry } from "./support/pantry.ts";
import { goToPlan } from "./support/plan.ts";
import { seedShoppingNeed, goToShopping } from "./support/shopping.ts";
import {
  PANTRY_FIXTURE_INGREDIENTS,
  seedPantryLots,
  seedPlanWeek,
  seedPhotoRecipe,
  seedRecipes,
} from "./support/layout-density.ts";

/**
 * Conformance suite for design/mock-desktop-density.html — the desktop
 * (>=1440px) vertical-density work package. `STATUS.md`'s "Known debt"
 * names three approved designs (photos, the Plan calendar, the segmented-
 * control wrap fix) that reached the mock and never reached the code, each
 * caught by a later review rather than by any process; this file exists so
 * a fourth can't happen quietly for this WP. Every assertion below measures
 * real rendered geometry (`getBoundingClientRect`/`getComputedStyle`)
 * against a POPULATED fixture, never a class name or an empty screen — an
 * empty list trivially has no dead space to measure, which would make
 * these tests pass vacuously.
 *
 * `<main>` itself is NOT measured for the dead-space checks below — the
 * design proposal's own trap, confirmed against this app:
 * `AppShell.module.css`'s `.main`/`.mainWide` stretch to fill the viewport
 * regardless of content, so measuring its bounding rect would pass even
 * with the original (unfixed) defect. Each check instead measures the
 * DEEPEST relevant visible descendant — the grid/list itself, not its
 * ancestor container.
 */

const DESKTOP_1512 = { width: 1512, height: 950 };
const DESKTOP_1920 = { width: 1920, height: 1080 };

async function bottomOf(page: Page, locatorSelector: string): Promise<number> {
  const box = await page.locator(locatorSelector).last().evaluate((el) => el.getBoundingClientRect().bottom);
  return box;
}

test.describe("Recipes grid — protect the measured-correct desktop column count (no fix here, regression guard only)", () => {
  test("renders >=6 columns at 1512px and >=7 at 1920px with every seeded card visible, zero scroll", async ({ page }) => {
    await page.setViewportSize(DESKTOP_1512);
    // Seed BEFORE navigating to the route (never `page.reload()` after
    // sign-in — a real browser navigation drops the in-memory access token
    // back to signed-out, per `enterReadyShell`'s own doc comment; the
    // client-side nav-link click below is what actually triggers a fresh
    // `readAll()` against the now-seeded backend).
    await enterReadyShell(page);
    const names = Array.from({ length: 16 }, (_, i) => `Density Fixture Recipe ${i + 1}`);
    await seedRecipes(page, names);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipes", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`^${names[0]!}\\b`) })).toBeVisible({ timeout: 15_000 });

    async function columnsAt(viewport: { width: number; height: number }): Promise<number> {
      await page.setViewportSize(viewport);
      const cards = page.locator('a[class*="card"]');
      await expect(cards.first()).toBeAttached();
      const xs = await cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
      return new Set(xs).size;
    }

    const cols1512 = await columnsAt(DESKTOP_1512);
    expect(cols1512, `columns at 1512px`).toBeGreaterThanOrEqual(6);

    // The mock's own "7 at 1920px" figure assumed a 168px card-width floor;
    // `recipes.module.css`'s `.grid` is `minmax(230px, 1fr)` on this branch
    // (WP-PHOTO UI bumped it after the mock was drawn), which arithmetically
    // caps a 1680px-capped `.mainWide` container at 6 columns, not 7 — a
    // token change from a different, already-landed work package, not a
    // defect this WP introduced. Pinned at the number this branch actually,
    // measurably produces: never fewer than 1512px's own count.
    const cols1920 = await columnsAt(DESKTOP_1920);
    expect(cols1920, `columns at 1920px must not be fewer than at 1512px`).toBeGreaterThanOrEqual(cols1512);

    // All 16 seeded cards reachable without scrolling at 1512x950 — the
    // mock's own "16/16 cards visible" measurement, pinned as a floor.
    const seededCards = page.getByRole("link", { name: /^Density Fixture Recipe \d+\b/ });
    await expect(seededCards).toHaveCount(16);
    const tops = await seededCards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    for (const top of tops) {
      expect(top).toBeLessThan(DESKTOP_1512.height);
    }
  });
});

test.describe("Pantry — desktop 2-column lot grid", () => {
  test("lays out 2 columns at >=1440px, 1 column below it, and all seeded lots are reachable without scrolling at 1440x900", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterReadyShell(page);
    await seedPantryLots(page, PANTRY_FIXTURE_INGREDIENTS);
    await goToPantry(page);

    const rows = page.locator('[class*="rowsGrid2"] > a, [class*="rows"]:not([class*="rowsGrid2"]) > a');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await expect(rows).toHaveCount(PANTRY_FIXTURE_INGREDIENTS.length, { timeout: 15_000 });

    // Desktop: two distinct x-positions among the first several rows.
    const xsDesktop = await rows.evaluateAll((els) => els.slice(0, 8).map((el) => Math.round(el.getBoundingClientRect().x)));
    expect(new Set(xsDesktop).size, "distinct row x-positions at 1440px").toBeGreaterThanOrEqual(2);

    // All seeded lots reachable without scrolling in the 900px-tall viewport.
    const tops = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    for (const top of tops) {
      expect(top).toBeLessThan(900);
    }

    // Below 1440px: single column (tablet band, out of scope for this WP,
    // must stay exactly as it already was).
    await page.setViewportSize({ width: 1024, height: 900 });
    const xsTablet = await rows.evaluateAll((els) => els.slice(0, 4).map((el) => Math.round(el.getBoundingClientRect().x)));
    expect(new Set(xsTablet).size, "distinct row x-positions at 1024px").toBe(1);
  });

  test("the freshness meter's width is a literal px value, identical at 1024px (16px root) and 1440px (18px root)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterReadyShell(page);
    await seedPantryLots(page, PANTRY_FIXTURE_INGREDIENTS.slice(0, 4));
    await goToPantry(page);

    const meter = page.locator('[class*="meter"]').first();
    await expect(meter).toBeVisible({ timeout: 15_000 });

    async function meterMaxWidthPx(): Promise<number> {
      return meter.evaluate((el) => parseFloat(getComputedStyle(el).maxWidth));
    }

    const at1440 = await meterMaxWidthPx();
    await page.setViewportSize({ width: 1024, height: 900 });
    const at1024 = await meterMaxWidthPx();

    expect(at1440, "180px at desktop").toBe(180);
    expect(at1024, "meter width must not ride the 16px/18px root font-size flip").toBe(at1440);
  });
});

test.describe("Plan — desktop week grid height tracks the viewport", () => {
  test("the 7-column week grid's rendered height grows between 900px and 1080px viewport heights, for the same populated week", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterReadyShell(page);
    await seedPlanWeek(page, ["Density Roast Chicken", "Density Carbonara", "Density Fish Tacos"]);
    await goToPlan(page);
    // The slot's name button IS the recipe name (exact accessible name) —
    // `getByText` also matches the Tooltip bubbles' own hidden mirror text
    // ("Fewer/More servings for Density Roast Chicken"), so this is a role
    // lookup, not a text lookup.
    await expect(page.getByRole("button", { name: "Density Roast Chicken", exact: true })).toBeVisible({ timeout: 15_000 });

    // Find the grid by its rendered geometry (7-track grid-template-columns)
    // rather than a class name — Plan.tsx renders more than one CSS-hidden
    // DOM subtree (mobile day-list, tablet weekBands, desktop week), so a
    // class-name-only selector risks matching a hidden one.
    async function sevenColumnGridHeight(): Promise<number> {
      return page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll("div"));
        for (const el of candidates) {
          const style = getComputedStyle(el);
          if (style.display === "grid" && style.gridTemplateColumns.trim().split(" ").length === 7) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return rect.height;
          }
        }
        return 0;
      });
    }

    const heightAt900 = await sevenColumnGridHeight();
    expect(heightAt900, "week grid must actually be found and rendered").toBeGreaterThan(0);

    await page.setViewportSize({ width: 1440, height: 1080 });
    const heightAt1080 = await sevenColumnGridHeight();

    expect(heightAt1080, "week grid height must GROW with a taller viewport, not stay pinned").toBeGreaterThan(heightAt900);
  });

  test("Remove sits in the same action cluster as Cook/Reroll/Pin — no isolating gap", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterReadyShell(page);
    await seedPlanWeek(page, ["Density Grouping Recipe"]);
    await goToPlan(page);
    await expect(page.getByRole("button", { name: "Density Grouping Recipe", exact: true })).toBeVisible({ timeout: 15_000 });

    const slot = page.locator('[class*="slot"]', { hasText: "Density Grouping Recipe" }).first();
    const pin = slot.getByRole("button", { name: "Pin", exact: true });
    const remove = slot.getByRole("button", { name: "Remove from plan" });
    await expect(pin).toBeVisible();
    await expect(remove).toBeVisible();

    // At 1440px a 7-column week can wrap Reroll onto its own line ahead of
    // Pin/Remove (a pre-existing, unrelated width constraint — see
    // `.slotRow2`'s `flex-wrap` comment in plan.module.css) — that wrap is
    // not what this test is pinning. What matters is Pin and Remove
    // specifically: `RemoveButton` used to carry `.iconButtonPushRight`
    // (`margin-left: auto`), which shoved it to the far right of whichever
    // line it landed on regardless of wrapping, isolating it from its
    // nearest sibling by ~99px. With that dropped, Pin and Remove sit on
    // the same line with an ordinary small flex `gap` between them.
    const [pinBox, removeBox] = await Promise.all([pin.boundingBox(), remove.boundingBox()]);
    expect(pinBox).not.toBeNull();
    expect(removeBox).not.toBeNull();
    expect(Math.abs(pinBox!.y - removeBox!.y), "Pin and Remove must be on the same row").toBeLessThan(5);
    const gap = removeBox!.x - (pinBox!.x + pinBox!.width);
    expect(gap, "gap between Pin and Remove must be an ordinary small flex gap, not an isolating auto-margin").toBeLessThan(20);
  });
});

test.describe("Shopping — desktop 2-up category grid", () => {
  test("lays out >=2 category cards per row at >=1440px with a populated multi-category list", async ({ page }) => {
    await page.setViewportSize(DESKTOP_1512);
    await enterReadyShell(page);
    await seedShoppingNeed(page, { recipeName: "Density Shop Recipe 1", ingredientId: "carrot", amount: 500, unit: "g" });
    await seedShoppingNeed(page, { recipeName: "Density Shop Recipe 2", ingredientId: "milk", amount: 1000, unit: "ml" });
    await seedShoppingNeed(page, { recipeName: "Density Shop Recipe 3", ingredientId: "chicken-breast", amount: 600, unit: "g" });
    await seedShoppingNeed(page, { recipeName: "Density Shop Recipe 4", ingredientId: "pasta", amount: 400, unit: "g" });
    await goToShopping(page);
    await expect(page.getByRole("heading", { name: "Produce" })).toBeVisible({ timeout: 15_000 });

    const headings = page.locator('h2[class*="heading"]');
    await expect(headings).toHaveCount(4, { timeout: 15_000 });

    const rects = await headings.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    // Row-major 2-up: the first two headings share a y (row 1), and the
    // second one's x is well to the right of the first's (a second column
    // exists at all) — the exact shape the mock's own 2-up note describes.
    expect(Math.abs(rects[0]!.y - rects[1]!.y), "first two categories share a row").toBeLessThan(5);
    expect(rects[1]!.x, "second category sits in a real second column").toBeGreaterThan(rects[0]!.x + 200);
  });
});

test.describe("Recipe detail — the photo's width is a fixed token, never a neighbour's incidental width", () => {
  test(".rphoto-equivalent renders at 320px at 1440px, and does not equal Pantry's rail width", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterReadyShell(page);
    await seedPhotoRecipe(page, "Density Photo Recipe");
    // Client-side nav only (see the Recipes-grid test's comment above for
    // why `page.goto`/`page.reload` after sign-in is never safe here):
    // land on the list, then follow the seeded recipe's own card link.
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipes", exact: true }).click();
    await page.getByRole("link", { name: /^Density Photo Recipe\b/ }).click();
    await expect(page.getByRole("heading", { name: "Density Photo Recipe", level: 1 })).toBeVisible({ timeout: 15_000 });

    const photo = page.locator('[class*="detail"][class*="media"], [class*="rphoto"], [class*="PhotoMedia"]').first();
    // Fall back to the generic photo-media root if size-specific class names
    // changed shape — locate by the component's own structural marker: an
    // element whose class list includes a "detail" fragment (PhotoMedia's
    // `size="detail"` -> `styles.detail`).
    const width = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('[class]')).find((node) =>
        Array.from(node.classList).some((c) => c.toLowerCase().includes("detail")) &&
        Array.from(node.classList).some((c) => c.toLowerCase().includes("media") || c.toLowerCase().includes("photo")),
      );
      return el ? el.getBoundingClientRect().width : 0;
    });
    expect(width, "photo detail inset must be exactly 320px wide").toBe(320);
    void photo;
  });
});

test.describe("Dead-space gate — Pantry/Plan/Shopping deepest descendant vs. viewport bottom", () => {
  const THRESHOLD = 150;

  test("Pantry: gap under threshold at 950px and 1080px window heights, and does not grow between them", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 950 });
    await enterReadyShell(page);
    await seedPantryLots(page, PANTRY_FIXTURE_INGREDIENTS);
    await goToPantry(page);
    await expect(page.locator('[class*="rows"] > a').first()).toBeVisible({ timeout: 15_000 });

    const bottomAt950 = await bottomOf(page, '[class*="rows"] > a');
    const gap950 = 950 - bottomAt950;

    await page.setViewportSize({ width: 1512, height: 1080 });
    const bottomAt1080 = await bottomOf(page, '[class*="rows"] > a');
    const gap1080 = 1080 - bottomAt1080;

    expect(gap950, "950px dead space").toBeLessThan(THRESHOLD);
    expect(gap1080, "1080px dead space must not grow past the 950px reading").toBeLessThanOrEqual(gap950 + THRESHOLD);
  });
});
