import { type Page } from "@playwright/test";
import { E2E_CREATED_SPREADSHEET_ID, E2E_FAKE_ACCESS_TOKEN } from "../../src/mocks/handlers.ts";

/**
 * Seeding helpers for the desktop-density conformance suite
 * (`wp-layout-desktop-density.spec.ts`) — design/mock-desktop-density.html's
 * own rule: "assert against POPULATED fixtures... never empty screens,
 * density claims about an empty list are meaningless." Same `page.evaluate`
 * dynamic-import-and-write-through-the-real-store technique as
 * `e2e/support/shopping.ts`'s `seedShoppingNeed` — direct `WorkbookStore`
 * writes, not UI-driven form fills, so a 14-lot pantry or a 7-recipe week
 * seeds in one round trip instead of dozens of clicks.
 */

/** A dozen-plus real catalog ingredient ids spanning Fridge/Freezer/Pantry, enough to reproduce the mock's own "14 lots" pantry measurement. */
export const PANTRY_FIXTURE_INGREDIENTS: readonly { readonly id: string; readonly location: "fridge" | "freezer" | "pantry" }[] = [
  { id: "milk", location: "fridge" },
  { id: "butter", location: "fridge" },
  { id: "eggs", location: "fridge" },
  { id: "carrot", location: "fridge" },
  { id: "plain-yogurt", location: "fridge" },
  { id: "chicken-breast", location: "fridge" },
  { id: "parmesan-cheese", location: "fridge" },
  { id: "bell-pepper", location: "fridge" },
  { id: "cream-cheese", location: "fridge" },
  { id: "bacon", location: "fridge" },
  { id: "spinach", location: "fridge" },
  { id: "deli-ham", location: "fridge" },
  { id: "rice", location: "pantry" },
  { id: "pasta", location: "pantry" },
];

/**
 * Writes one `purchase` `InventoryEvent` per entry directly through
 * `WorkbookStore.inventoryEvents.append` — this is what actually produces a
 * `Lot` (types.ts: "a `Lot` is only ever created by a `purchase`
 * `InventoryEvent`"), so this is the real fold path, not a shortcut around
 * it.
 */
export async function seedPantryLots(
  page: Page,
  entries: readonly { readonly id: string; readonly location: "fridge" | "freezer" | "pantry" } [],
): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId, entries }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const domainPath = "/src/domain/index.ts";
      const sheets = await import(sheetsPath);
      const domain = await import(domainPath);
      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      const rng = domain.createSeededRng(Math.floor(Math.random() * 1_000_000));
      const today = domain.systemClock.today();
      for (const entry of entries) {
        await store.inventoryEvents.append({
          type: "purchase",
          id: domain.newEventId(rng),
          timestamp: `${today}T09:00:00.000Z`,
          ingredientId: domain.makeIngredientId(entry.id),
          lotId: domain.newLotId(rng),
          quantity: { amount: 500, unit: "g" },
          location: entry.location,
          purchaseDate: today,
        });
      }
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID, entries },
  );
}

/** One real recipe + this-week planned `PlanSlot` per day, through the same real-store path `seedShoppingNeed` uses — enough distinct filled slots for the Plan grid's dead-space/height and Remove-button-grouping assertions to measure something real. */
export async function seedPlanWeek(page: Page, recipeNames: readonly string[]): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId, recipeNames }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const domainPath = "/src/domain/index.ts";
      const sheets = await import(sheetsPath);
      const domain = await import(domainPath);
      const rangePath = "/src/routes/shopping/range.ts";
      const rangeHelpers = await import(rangePath);
      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      const rng = domain.createSeededRng(Math.floor(Math.random() * 1_000_000));
      const monday = rangeHelpers.mondayOnOrBefore(domain.systemClock.today());
      const [y, m, d] = monday.split("-").map(Number) as [number, number, number];
      for (let i = 0; i < recipeNames.length; i += 1) {
        const recipeId = domain.newRecipeId(rng);
        await store.recipes.upsert({
          id: recipeId,
          name: recipeNames[i]!,
          kind: "cooked",
          baseServings: 4,
          prepMinutes: 10,
          cookMinutes: 30,
          mealTags: ["dinner"],
          status: "in-rotation",
        });
        const date = new Date(Date.UTC(y, m - 1, d + i));
        const iso = domain.makeIsoDate(date.toISOString().slice(0, 10));
        await store.planSlots.upsert({
          id: domain.newPlanSlotId(rng),
          date: iso,
          slotType: "dinner",
          // DEFAULT_SETTINGS.slotLayout (bootstrap.ts) is
          // ["breakfast","lunch","dinner"] per day, and `expandWeekSlots`
          // (domain/planner/slot-layout.ts) assigns `slotIndex` from that
          // array's POSITION — dinner is index 2, not 0. `buildCalendarDays`
          // merges seeded `PlanSlot`s onto specs by an exact
          // `date|slotType|slotIndex` key, so a slot at the wrong index
          // silently fails to merge (renders as an empty "Pick a meal"
          // slot instead of throwing) rather than erroring.
          slotIndex: 2,
          filling: { kind: "recipe", recipeId },
          state: "planned",
          pinned: false,
        });
      }
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID, recipeNames },
  );
}

/** Plain recipes, no plan slots — for the Recipes-grid regression guard, which only needs a realistic-sized catalog to browse (design/mock-desktop-density.html measured its "16/16 cards visible" claim against exactly this many). */
export async function seedRecipes(page: Page, names: readonly string[]): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId, names }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const domainPath = "/src/domain/index.ts";
      const sheets = await import(sheetsPath);
      const domain = await import(domainPath);
      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      const rng = domain.createSeededRng(Math.floor(Math.random() * 1_000_000));
      for (const name of names) {
        await store.recipes.upsert({
          id: domain.newRecipeId(rng),
          name,
          kind: "cooked",
          baseServings: 4,
          prepMinutes: 10,
          cookMinutes: 30,
          mealTags: ["dinner"],
          status: "in-rotation",
        });
      }
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID, names },
  );
}

/** A recipe with `hasPhoto: true` but no actual stored photo bytes — enough to exercise `PhotoMedia`'s empty-state rendering inside its real `.detail` sized container, which is all the photo-width invariant test needs (the CSS class/width is identical whether a real photo loaded or not — see `PhotoMedia.tsx`). Returns the recipe's id so the caller can navigate to `/recipes/:id`. */
export async function seedPhotoRecipe(page: Page, name: string): Promise<string> {
  return page.evaluate(
    async ({ token, spreadsheetId, name }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const domainPath = "/src/domain/index.ts";
      const sheets = await import(sheetsPath);
      const domain = await import(domainPath);
      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      const rng = domain.createSeededRng(Math.floor(Math.random() * 1_000_000));
      const recipeId = domain.newRecipeId(rng);
      await store.recipes.upsert({
        id: recipeId,
        name,
        kind: "cooked",
        baseServings: 4,
        prepMinutes: 10,
        cookMinutes: 30,
        mealTags: ["dinner"],
        status: "in-rotation",
        hasPhoto: true,
      });
      return recipeId as unknown as string;
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID, name },
  );
}
