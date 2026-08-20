import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { E2E_CREATED_SPREADSHEET_ID, E2E_FAKE_ACCESS_TOKEN } from "../src/mocks/handlers.ts";

// IMPLEMENTATION_PLAN.md WP-23, `@e2e`:
//
// Feature: Shopping trip
//   Scenario: The full loop
//     Given a planned week needing 400 g of rice and the pantry has 0 g
//     When the user opens the shopping list for that week
//     Then it shows "rice: 400 g"
//     When they check it off entering 1000 g
//     Then the item shows as bought
//     And the pantry gains a 1000 g rice lot
//     And regenerating the list shows no rice line

/**
 * Seeds a recipe (400 g rice at baseServings == a scale-1 household size)
 * and a Monday-of-this-week `PlanSlot` for it, through the REAL
 * `WorkbookStore` contract (the same calls a real Planner UI would make) —
 * not through the Planner UI itself, which doesn't exist yet: WP-22 is a
 * concurrent sibling work package, and this WP's own brief says to "build
 * against WorkbookStore.planSlots and WP-14's engine directly — do not
 * wait, and do not import anything from src/routes/plan/".
 *
 * Runs inside the PAGE (not the Playwright/Node process) via `page.evaluate`,
 * dynamically importing the app's own source modules from the Vite dev
 * server (`npm run dev`, this project's `webServer` — see
 * playwright.config.ts) — so the resulting Sheets API calls are made from
 * the browser and therefore actually pass through msw's browser Service
 * Worker (src/mocks/handlers.ts), landing in the exact same in-memory fake
 * backend the rest of the app reads from. A fixed fake bearer token/
 * spreadsheet id (both exported constants every E2E spec shares) stand in
 * for the real `GoogleAuth`, which normally only becomes reachable through
 * `enterReadyShell`'s own sign-in click.
 */
async function seedRicePlanForThisWeek(page: Page): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId }) => {
      // Non-literal specifiers, deliberately: a literal `import("/src/...")`
      // is a root-relative path Vite's dev server resolves at RUNTIME, but
      // `tsc -b` (npm run build/typecheck) tries to resolve it as a module
      // too and fails with TS2307 — it has no notion of Vite's serving
      // root. Building the path in a variable opts these three calls out of
      // TypeScript's static module resolution (the import()s below return
      // `any`), which is exactly what's wanted for a dynamic, dev-server-
      // only import.
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

test("Shopping trip: the full loop", async ({ page }) => {
  // Given a planned week needing 400 g of rice and the pantry has 0 g —
  // land on Home first (a fresh workbook has 0 g of everything), seed the
  // plan, then navigate to Shopping via the real nav so its data hook boots
  // fresh against the now-seeded workbook (it only reads planSlots on
  // mount, same as every other route's container — see useShoppingList.ts).
  await enterReadyShell(page);
  await seedRicePlanForThisWeek(page);

  // When the user opens the shopping list for that week
  await page.getByRole("link", { name: "Shopping", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();

  // Then it shows "rice: 400 g"
  const riceRow = page.getByRole("checkbox", { name: /rice/i });
  await expect(riceRow).toBeVisible();
  await expect(page.getByRole("main")).toContainText("400 g");

  // When they check it off entering 1000 g
  await riceRow.click();
  await expect(page.getByRole("heading", { name: /check off rice/i })).toBeVisible();
  await page.getByRole("textbox", { name: /quantity bought/i }).fill("1000");
  await page.getByRole("button", { name: "Mark bought" }).click();

  // Then the item shows as bought
  await expect(riceRow).toBeChecked();
  await expect(page.getByRole("main")).toContainText(/bought 1000 g/i);

  // And the pantry gains a 1000 g rice lot
  await page.getByRole("link", { name: "Pantry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rice" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("1000 g");

  // And regenerating the list shows no rice line — live recompute
  // (DESIGN.md §2 "Recomputed live as the plan changes"): the pantry now
  // has enough viable rice, so re-opening the same range's list drops the
  // line entirely.
  await page.getByRole("link", { name: "Shopping", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /rice/i })).toHaveCount(0);
});

// e2e/wp-15-a11y.spec.ts's ROUTES sweep only ever sees "/shopping" on a
// fresh, empty workbook (EmptyState) — a materially different DOM from a
// populated list (CheckRow, the check-off sheet). This screen "matters most
// on mobile" (WP-23's brief), so both are scanned here, on both Playwright
// projects (chromium AND mobile-chrome — no `test.skip` on either).
test("Shopping list and check-off sheet have no axe violations", async ({ page }) => {
  await enterReadyShell(page);
  await seedRicePlanForThisWeek(page);
  await page.getByRole("link", { name: "Shopping", exact: true }).click();

  const riceRow = page.getByRole("checkbox", { name: /rice/i });
  await expect(riceRow).toBeVisible();
  const listResults = await new AxeBuilder({ page }).analyze();
  expect(listResults.violations, JSON.stringify(listResults.violations, null, 2)).toEqual([]);

  await riceRow.click();
  await expect(page.getByRole("heading", { name: /check off rice/i })).toBeVisible();
  const sheetResults = await new AxeBuilder({ page }).analyze();
  expect(sheetResults.violations, JSON.stringify(sheetResults.violations, null, 2)).toEqual([]);
});
