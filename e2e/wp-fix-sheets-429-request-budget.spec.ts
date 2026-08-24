import { expect, test, type Page } from "@playwright/test";
import { bridgedPath, createSharedWorkbookBackend } from "./support/shared-workbook.ts";
import {
  makeBarcode,
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makePlanSlotId,
  makePriceObservationId,
  makeProductId,
  makeQuantity,
  makeRecipeId,
  makeStepId,
  type Ingredient,
  type InventoryEvent,
  type Photo,
  type PlanSlot,
  type Product,
  type ProductBarcode,
  type Recipe,
  type RecipeIngredient,
  type RecipeStep,
  type Settings,
  type ShoppingItem,
} from "../src/domain/types.ts";
import type { WorkbookStore } from "../src/domain/contracts.ts";

/**
 * Production incident (owner report): Pantry on a phone against the live
 * app failed with a raw 429 — the transport already retries 429 with
 * backoff, so reaching the user means the per-minute Sheets read quota was
 * PERSISTENTLY exhausted, not momentarily unlucky (see this WP's own brief).
 * This spec pins the fix as an invariant, not a one-off measurement: an
 * upper bound on Sheets/Drive REST requests for app open and for switching
 * to each main route, against a fixture populated enough to be realistic
 * (a dozen photographed pantry ingredients, several recipes, a handful of
 * shopping items and a small week of plan slots — the "one phone screen"
 * scale the owner actually hit).
 *
 * Thresholds are deliberately loose upper bounds, not exact counts: exact
 * equality would make this spec change every time an unrelated feature adds
 * one legitimate read, which teaches everyone to bump the number without
 * thinking (exactly how the count crept up to the reported failure in the
 * first place, per this WP's brief). Each bound below is commented with what
 * it is actually guarding against — a route regressing to "one request per
 * visible item" or "reads the same sheet twice" — not a specific number of
 * network calls.
 *
 * Uses `shared-workbook.ts`'s Node-side backend (WP-30's multi-client
 * infrastructure) purely for its `store: WorkbookStore` — a fast, direct way
 * to seed a realistic fixture without clicking through forms for a dozen
 * items — not because this spec needs more than one browser context.
 */

const GOOGLE_HOSTS = new Set(["sheets.googleapis.com", "www.googleapis.com"]);

function isGoogleApiRequest(url: string): boolean {
  try {
    return GOOGLE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Counts Sheets/Drive REST requests issued while `action` runs. Includes every attempt (a transport retry counts once per attempt) — this spec's fixture never provokes a retry, so in practice this is "requests issued", not "requests that succeeded". */
async function countGoogleRequests(page: Page, action: () => Promise<void>): Promise<number> {
  let count = 0;
  const onRequest = (req: { url(): string }) => {
    if (isGoogleApiRequest(req.url())) count += 1;
  };
  page.on("request", onRequest);
  try {
    await action();
  } finally {
    page.off("request", onRequest);
  }
  return count;
}

const TINY_PHOTO_DATA_URL = "data:image/webp;base64,dGVzdC1waG90by1ieXRlcw==";

function photoFor(ownerKind: Photo["ownerKind"], ownerId: string): Photo {
  return {
    ownerKind,
    ownerId: ownerId as Photo["ownerId"],
    dataUrl: TINY_PHOTO_DATA_URL,
    updatedAt: makeIsoTimestamp("2026-03-01T09:00:00Z"),
  };
}

/**
 * A "one phone screen" fixture: a dozen photographed pantry ingredients (the
 * owner's own description of what they had open when the 429 hit), plus
 * enough recipes/plan/shopping/product data that every main route has real
 * rows to render, not an empty-state shortcut.
 */
async function seedRealisticWorkbook(store: WorkbookStore): Promise<void> {
  await store.meta.write({ schemaVersion: 1, generation: 1 });
  const settings: Settings = {
    householdSize: 4,
    slotLayout: [
      { day: "monday", slots: ["dinner"] },
      { day: "tuesday", slots: ["dinner"] },
      { day: "wednesday", slots: ["dinner"] },
      { day: "thursday", slots: ["dinner"] },
      { day: "friday", slots: ["dinner"] },
    ],
    repeatExclusionWeeks: 3,
    currency: "$",
  };
  await store.settings.write(settings);

  // 12 pantry ingredients, every one photographed — the exact shape the
  // owner reported ("a pantry of a dozen photographed items").
  const ingredientNames = [
    "Rice",
    "Black beans",
    "Chicken thighs",
    "Onions",
    "Garlic",
    "Canned tomatoes",
    "Olive oil",
    "Cheddar cheese",
    "Eggs",
    "Milk",
    "Spinach",
    "Flour",
  ];
  const ingredients: Ingredient[] = ingredientNames.map((name, i) => ({
    id: makeIngredientId(`ing-${i}`),
    name,
    unit: "g",
    shelfLifeDays: 365,
    openedShelfLifeDays: 30,
    defaultLocation: "pantry",
    hasPhoto: true,
  }));
  for (const ingredient of ingredients) {
    await store.ingredients.upsert(ingredient);
    await store.photos.upsert(photoFor("ingredient", ingredient.id));
  }

  // One purchase lot per ingredient — a normally-stocked pantry, not empty.
  for (const [i, ingredient] of ingredients.entries()) {
    const event: InventoryEvent = {
      type: "purchase",
      id: makeEventId(`evt-${i}`),
      timestamp: makeIsoTimestamp(`2026-03-0${(i % 9) + 1}T09:00:00Z`),
      ingredientId: ingredient.id,
      lotId: makeLotId(`lot-${i}`),
      quantity: makeQuantity(500, "g"),
      location: "pantry",
      purchaseDate: makeIsoDate("2026-03-01"),
    };
    await store.inventoryEvents.append(event);
  }

  // 5 recipes, most photographed, each with a couple of ingredient lines and steps.
  const recipeNames = ["Chili", "Fried rice", "Tomato soup", "Spinach omelette", "Bean burritos"];
  const recipes: Recipe[] = recipeNames.map((name, i) => ({
    id: makeRecipeId(`recipe-${i}`),
    name,
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 15,
    cookMinutes: 30,
    mealTags: ["dinner"],
    status: "in-rotation",
    hasPhoto: i < 4,
  }));
  for (const recipe of recipes) {
    await store.recipes.upsert(recipe);
    if (recipe.hasPhoto) await store.photos.upsert(photoFor("recipe", recipe.id));
    const lines: RecipeIngredient[] = ingredients.slice(0, 2).map((ing) => ({
      recipeId: recipe.id,
      ingredientId: ing.id,
      quantity: makeQuantity(200, "g"),
    }));
    await store.recipeIngredients.replaceForRecipe(recipe.id, lines);
    const steps: RecipeStep[] = [
      { recipeId: recipe.id, id: makeStepId(`${recipe.id}-step-1`), stepNumber: 1, description: "Prepare everything." },
      { recipeId: recipe.id, id: makeStepId(`${recipe.id}-step-2`), stepNumber: 2, description: "Cook and serve." },
    ];
    await store.recipeSteps.replaceForRecipe(recipe.id, steps);
  }

  // A small week of plan slots, one recipe per weekday.
  const days = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"];
  for (const [i, day] of days.entries()) {
    const slot: PlanSlot = {
      id: makePlanSlotId(`slot-${i}`),
      date: makeIsoDate(day),
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "recipe", recipeId: recipes[i % recipes.length]!.id },
      state: "planned",
      pinned: false,
    };
    await store.planSlots.upsert(slot);
  }

  // A handful of shopping-list rows.
  for (const ingredient of ingredients.slice(0, 5)) {
    const item: ShoppingItem = {
      ingredientId: ingredient.id,
      rangeStart: makeIsoDate("2026-03-02"),
      rangeEnd: makeIsoDate("2026-03-08"),
      neededQuantity: makeQuantity(300, "g"),
      checked: false,
    };
    await store.shoppingItems.upsert(item);
  }

  // A few products with barcodes and one price observation each.
  for (let i = 0; i < 3; i += 1) {
    const productId = makeProductId(`product-${i}`);
    const barcode = makeBarcode(`800112000012${i}`);
    const product: Product = {
      id: productId,
      name: `Store brand ${ingredients[i]!.name}`,
      brand: "Store brand",
      ingredientId: ingredients[i]!.id,
      canonicalQuantity: makeQuantity(500, "g"),
      displayQuantity: 500,
      displayUnit: "g",
      shelfLifeDays: 365,
      isBulk: false,
      hasPhoto: i === 0,
    };
    await store.products.upsert(product);
    if (product.hasPhoto) await store.photos.upsert(photoFor("product", productId));
    const barcodeRow: ProductBarcode = { productId, barcode };
    await store.productBarcodes.upsert(barcodeRow);
    await store.priceObservations.append({
      id: makePriceObservationId(`obs-${i}`),
      timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
      barcode,
      ingredientId: ingredients[i]!.id,
      quantity: makeQuantity(500, "g"),
      price: 2 + i,
      source: "Corner store",
    });
  }
}

test.describe("Sheets API request budget (WP-fix-sheets-429)", () => {
  test("app open and each main route stay within their request budget against a realistic fixture", async ({
    browser,
  }) => {
    const backend = createSharedWorkbookBackend({ spreadsheetId: "wp-fix-sheets-429-request-budget" });
    try {
      await seedRealisticWorkbook(backend.store);

      const context = await browser.newContext();
      await backend.install(context);
      const page = await context.newPage();

      const results: Record<string, number> = {};

      // App open: sign in, open the seeded workbook, land on Home (the
      // index route) with its dashboard fully loaded. This is the exact
      // "just opened the app" moment the owner's phone hit the 429 in.
      results["App open (sign in -> Home)"] = await countGoogleRequests(page, async () => {
        await page.goto(bridgedPath(""));
        await page.getByRole("button", { name: "Sign in with Google" }).click();
        await page.getByRole("button", { name: "Open existing…" }).click();
        await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole("main")).toBeVisible();
        // Wait for the dashboard's own loading state to clear rather than
        // just the shell - a skeleton still on screen means reads are
        // still in flight and would be missed by this measurement window.
        await expect(page.getByText(/couldn.?t load/i)).toHaveCount(0);
        await page.waitForLoadState("networkidle");
      });

      async function measureRoute(navName: string, heading: string): Promise<void> {
        results[navName] = await countGoogleRequests(page, async () => {
          await page
            .getByRole("navigation", { name: "Primary" })
            .getByRole("link", { name: navName, exact: true })
            .click();
          await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
          await expect(page.getByText(/couldn.?t load/i)).toHaveCount(0);
          await page.waitForLoadState("networkidle");
        });
      }

      await measureRoute("Pantry", "Pantry");
      await measureRoute("Recipes", "Recipes");
      await measureRoute("Plan", "Plan");
      await measureRoute("Shopping", "Shopping");

      // Deliberate: the measurement table this WP's brief asks to be
      // reported, visible in the Playwright output for whoever re-runs this
      // spec after a future change.
      console.log("Sheets/Drive API request counts (WP-fix-sheets-429):", results);

      // Thresholds below are upper bounds against THIS fixture (12
      // photographed ingredients, 5 recipes, 5 plan slots, 5 shopping rows),
      // set to roughly double the observed count at the time this spec was
      // written (App open 6, Pantry 4, Recipes 0, Plan 4, Shopping 3) — a
      // fixed +N buffer would be too tight for the smaller counts and too
      // loose for the larger ones, so a multiplier keeps every route
      // meaningfully bounded. Enough headroom that one legitimate added read
      // doesn't flake this spec, but nowhere near the naive "one request per
      // visible item" pattern this WP fixed: that pattern alone would have
      // put Pantry's 12 photos at 24+ requests before counting anything
      // else, well past every bound here.
      expect(results["App open (sign in -> Home)"]!).toBeLessThanOrEqual(12);
      expect(results["Pantry"]!).toBeLessThanOrEqual(10);
      expect(results["Recipes"]!).toBeLessThanOrEqual(6);
      expect(results["Plan"]!).toBeLessThanOrEqual(10);
      expect(results["Shopping"]!).toBeLessThanOrEqual(8);
    } finally {
      await backend.close();
    }
  });
});
