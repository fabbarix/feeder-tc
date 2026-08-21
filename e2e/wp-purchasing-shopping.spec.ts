import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { E2E_CREATED_SPREADSHEET_ID, E2E_FAKE_ACCESS_TOKEN } from "../src/mocks/handlers.ts";

// WP-PURCHASING (DESIGN_PURCHASING.md) — the live defect this whole package
// fixes: "a bought lasagna serving 4, in a household of 2, appears on the
// shopping list as '0.5 Store Bought Lasagna.'" Definition-of-done asks for
// three E2E scenarios: the lasagna case end to end, a whole-pack round-up,
// and an override surviving a plan recompute.
//
// All three seed data through the REAL WorkbookStore contract, run inside
// the PAGE via `page.evaluate` — the same pattern
// e2e/wp-23-shopping-trip.spec.ts uses (see that file's own doc comment for
// why: dynamic imports so the resulting Sheets API calls pass through msw's
// browser Service Worker and land in the same in-memory fake backend the
// rest of the app reads from).

test("Lasagna case end to end: a bought meal serving 4, household 2, buys 1 — never 0.5", async ({ page }) => {
  await enterReadyShell(page);

  // Given: household size is 2 (bootstrap's default, src/sheets/bootstrap.ts)
  // and a bought recipe "Store lasagna" (baseServings 4, indivisible by
  // default because kind === "bought") is planned for a day this week.
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
      const rng = domain.createSeededRng(2);

      const lasagnaIngredientId = domain.newIngredientId(rng);
      await store.ingredients.upsert({
        id: lasagnaIngredientId,
        name: "Store lasagna",
        unit: "piece",
        shelfLifeDays: 5,
        openedShelfLifeDays: 2,
        defaultLocation: "freezer",
        category: "frozen",
      });

      const recipeId = domain.newRecipeId(rng);
      await store.recipes.upsert({
        id: recipeId,
        name: "Store lasagna",
        kind: "bought",
        baseServings: 4,
        prepMinutes: 0,
        cookMinutes: 35,
        mealTags: ["dinner"],
        status: "in-rotation",
      });
      await store.recipeIngredients.replaceForRecipe(recipeId, [
        { recipeId, ingredientId: lasagnaIngredientId, quantity: { amount: 1, unit: "piece" } },
      ]);

      const monday = rangeHelpers.mondayOnOrBefore(domain.systemClock.today());
      await store.planSlots.upsert({
        id: domain.newPlanSlotId(rng),
        date: domain.addDays(monday, 4), // Friday, matching the mock
        slotType: "dinner",
        // Bootstrap's default Settings.slotLayout is [breakfast, lunch,
        // dinner] per day (src/sheets/bootstrap.ts) — slotIndex must match
        // dinner's actual position (2) for the Plan route's mergeWeekSlots
        // to fold this real row into the right placeholder slot.
        slotIndex: 2,
        filling: { kind: "recipe", recipeId },
        state: "planned",
        pinned: false,
      });
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID },
  );

  await page.getByRole("link", { name: "Shopping", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();

  const lasagnaRow = page.locator("label").filter({ hasText: "Store lasagna" });
  await expect(lasagnaRow).toBeVisible();

  // The defect this package fixes: never "0.5".
  await expect(lasagnaRow).not.toContainText("0.5");
  // The honest fix (§4): buy 1 whole unit, and the row explains the yield.
  await expect(lasagnaRow).toContainText("serves 4, you need 2");

  // The "Why?" disclosure explains the leftover forecast (§6).
  await lasagnaRow.locator("xpath=following-sibling::details[1]").locator("summary").click();
  await expect(page.getByText(/can't be split/i).first()).toBeVisible();
  await expect(page.getByText(/leftover/i).first()).toBeVisible();

  // §6 last bullet / §9.3: the Plan slot itself forecasts the leftover.
  // Plan renders both a mobile day-card layout and a desktop/tablet week
  // grid in the same DOM (CSS toggles which is visible per breakpoint), so
  // this checks the badge is rendered at all rather than asserting
  // visibility, which would otherwise depend on which project's viewport
  // happens to match which tier.
  await page.getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page.getByText(/→ 2 leftover/i).first()).toBeAttached();
});

test("Whole-pack round-up: three meals needing mayonnaise round to one 250 ml jar, not three", async ({ page }) => {
  await enterReadyShell(page);

  // Mayonnaise is seeded (src/data/seed-catalog.ts) with purchaseMode:
  // "whole" and a 250 ml packSize — exactly DESIGN_PURCHASING.md §5's own
  // worked example. A cooked recipe at baseServings 1, household 2, needing
  // 25 ml mayo scales to 50 ml needed.
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
      const rng = domain.createSeededRng(3);

      const recipeId = domain.newRecipeId(rng);
      await store.recipes.upsert({
        id: recipeId,
        name: "Mayo dressing",
        kind: "cooked",
        baseServings: 1,
        prepMinutes: 5,
        cookMinutes: 0,
        mealTags: ["lunch"],
        status: "in-rotation",
      });
      await store.recipeIngredients.replaceForRecipe(recipeId, [
        { recipeId, ingredientId: domain.makeIngredientId("mayonnaise"), quantity: { amount: 25, unit: "ml" } },
      ]);

      const monday = rangeHelpers.mondayOnOrBefore(domain.systemClock.today());
      await store.planSlots.upsert({
        id: domain.newPlanSlotId(rng),
        date: monday,
        slotType: "lunch",
        slotIndex: 1, // bootstrap's default layout is [breakfast, lunch, dinner]
        filling: { kind: "recipe", recipeId },
        state: "planned",
        pinned: false,
      });
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID },
  );

  await page.getByRole("link", { name: "Shopping", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();

  const mayoRow = page.locator("label").filter({ hasText: "Mayonnaise" });
  await expect(mayoRow).toBeVisible();
  // Buy-primary: the whole-jar amount is what the row shows, needs is context.
  await expect(mayoRow).toContainText("250 ml");
  await expect(mayoRow).toContainText("needs 50 ml");

  await mayoRow.locator("xpath=following-sibling::details[1]").locator("summary").click();
  await expect(page.getByText(/sold in 250 ml/i).first()).toBeVisible();
  await expect(page.getByText(/surplus/i).first()).toBeVisible();
});

async function seedOnionSoupThisWeek(page: Page): Promise<void> {
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
      const rng = domain.createSeededRng(4);

      const recipeId = domain.newRecipeId(rng);
      await store.recipes.upsert({
        id: recipeId,
        name: "Onion soup",
        kind: "cooked",
        baseServings: 2,
        prepMinutes: 10,
        cookMinutes: 30,
        mealTags: ["dinner"],
        status: "in-rotation",
      });
      await store.recipeIngredients.replaceForRecipe(recipeId, [
        { recipeId, ingredientId: domain.makeIngredientId("onion"), quantity: { amount: 1, unit: "piece" } },
      ]);

      const monday = rangeHelpers.mondayOnOrBefore(domain.systemClock.today());
      await store.planSlots.upsert({
        id: domain.newPlanSlotId(rng),
        date: monday,
        slotType: "dinner",
        slotIndex: 2, // bootstrap's default layout is [breakfast, lunch, dinner]
        filling: { kind: "recipe", recipeId },
        state: "planned",
        pinned: false,
      });
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID },
  );
}

test("An adjust override survives a plan recompute", async ({ page }) => {
  await enterReadyShell(page);

  // Onion (seeded piece/whole, §11.2) needing exactly 1 -> no rounding by
  // default, so any change to "2" observed later can only be the override.
  await seedOnionSoupThisWeek(page);

  await page.getByRole("link", { name: "Shopping", exact: true }).click();
  const onionRow = page.locator("label").filter({ hasText: "Onion" });
  await expect(onionRow).toBeVisible();
  await expect(onionRow).toContainText("1");

  // Tap the quantity to open the adjust stepper (§6 scenario 9) and bump it up.
  await onionRow.getByRole("button").click();
  await expect(page.getByRole("heading", { name: /adjust: onion/i })).toBeVisible();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: /^Save/ }).click();

  await expect(onionRow).toContainText("2");
  await expect(onionRow).toContainText(/adjusted/i);

  // A plan recompute (leaving and returning to Shopping remounts the route,
  // re-reading everything from the workbook — the same "regenerating the
  // list" recompute wp-23's own spec exercises) must NOT discard the
  // household's explicit choice — only a persisted ShoppingItem row could
  // survive this, never anything derived purely from the plan.
  await page.getByRole("link", { name: "Pantry", exact: true }).click();
  await page.getByRole("link", { name: "Shopping", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();

  const onionRowAfter = page.locator("label").filter({ hasText: "Onion" });
  await expect(onionRowAfter).toContainText("2");
  await expect(onionRowAfter).toContainText(/adjusted/i);
});
