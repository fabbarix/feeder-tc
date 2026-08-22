import { expect, type Page } from "@playwright/test";
import { E2E_CREATED_SPREADSHEET_ID, E2E_FAKE_ACCESS_TOKEN } from "../../src/mocks/handlers.ts";

export async function goToShopping(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Shopping", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();
}

/**
 * Seeds a recipe + a this-week `PlanSlot` needing the given ingredient,
 * through the real `WorkbookStore` contract — same `page.evaluate` dynamic-
 * import trick as `e2e/wp-23-shopping-trip.spec.ts`'s own
 * `seedRicePlanForThisWeek` and `e2e/m6-barcode-scan.spec.ts`'s
 * `seedRiceNeedForToday`, generalised to any seeded catalog ingredient so
 * the journey suite can put more than one concrete need on the list without
 * a copy-pasted seeding function per ingredient.
 */
export async function seedShoppingNeed(
  page: Page,
  input: { readonly recipeName: string; readonly ingredientId: string; readonly amount: number; readonly unit: string },
): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId, input }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const domainPath = "/src/domain/index.ts";
      const rangePath = "/src/routes/shopping/range.ts";
      const sheets = await import(sheetsPath);
      const domain = await import(domainPath);
      const rangeHelpers = await import(rangePath);

      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      const rng = domain.createSeededRng(Math.floor(Math.random() * 1_000_000));

      const recipeId = domain.newRecipeId(rng);
      await store.recipes.upsert({
        id: recipeId,
        name: input.recipeName,
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
          ingredientId: domain.makeIngredientId(input.ingredientId),
          quantity: { amount: input.amount, unit: input.unit },
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
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID, input },
  );
}

/** The four fixed-length range presets (`range.ts`'s `RANGE_PRESET_OPTIONS`) — always present at every tier. */
export async function selectRangePreset(page: Page, label: "This week" | "Next week" | "2 weeks" | "4 weeks"): Promise<void> {
  await page.getByRole("group", { name: "Shopping range" }).getByRole("button", { name: label }).click();
}

/** Checks off a not-yet-bought row: opens the confirm sheet pre-filled with the suggested amount, then confirms. */
export async function checkOffItem(page: Page, ingredientName: string, actualAmount?: string): Promise<void> {
  await page.getByRole("checkbox", { name: new RegExp(ingredientName, "i") }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`check off ${ingredientName}`, "i") })).toBeVisible();
  if (actualAmount) {
    await page.getByRole("textbox", { name: /quantity bought/i }).fill(actualAmount);
  }
  await page.getByRole("button", { name: "Mark bought" }).click();
}

/**
 * The quantity-adjust stepper (`ShoppingRow.tsx`'s `onAdjust` — the trailing
 * buy-amount button on a not-yet-checked row) — persists
 * `ShoppingItem.purchaseOverride` without checking the item off.
 */
export async function adjustQuantity(page: Page, ingredientRowText: RegExp, times = 1): Promise<void> {
  const row = page.getByRole("checkbox", { name: ingredientRowText }).locator("xpath=ancestor::label[1]");
  await row.getByRole("button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /^Adjust:/ })).toBeVisible();
  for (let i = 0; i < times; i += 1) {
    await dialog.getByRole("button", { name: "More" }).click();
  }
  await dialog.getByRole("button", { name: /^Save/ }).click();
}

/**
 * Opens a row's own "Why?" disclosure (`ShoppingRow.tsx`'s `.why`, built
 * from `provenance.ts`'s `buildRoundingExplanation`) — present at every
 * tier, no viewport gating, BUT only rendered when the suggested buy amount
 * differs from the raw need (a loose ingredient with no catalog pack size,
 * e.g. Rice, is never rounded, so plain "needs 274 g" lines never grow this
 * disclosure at all — confirmed empirically, not assumed). Returns `false`
 * without clicking anything if this line has no such disclosure, so a
 * caller can assert on that absence instead of hanging forever waiting for
 * an element that will never appear.
 */
export async function openWhyDisclosureIfPresent(page: Page, ingredientName: string): Promise<boolean> {
  const row = page.getByRole("checkbox", { name: new RegExp(ingredientName, "i") }).locator("xpath=ancestor::label[1]");
  const details = row.locator("xpath=following-sibling::details[1]");
  if ((await details.count()) === 0) return false;
  await details.locator("summary").click();
  return true;
}

/** Reachable at every tier since af73a08 — the FAB (phone, <768px) and the page action (tablet/desktop, >=768px) share the same accessible name and are mirror-image media queries (`e2e/m6-scan-reachable.spec.ts` already pins this as its own dedicated regression test). */
export async function reachScanner(page: Page): Promise<void> {
  await page.getByRole("button", { name: /scan a barcode/i }).click();
  await expect(page).toHaveURL(/\/scan$/);
}
