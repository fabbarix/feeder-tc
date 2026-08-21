import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { E2E_CREATED_SPREADSHEET_ID, E2E_FAKE_ACCESS_TOKEN } from "../src/mocks/handlers.ts";

// M6 (DESIGN_PRODUCTS.md §1.4), `@e2e` — the price-history view, the last
// piece of M6 (STATUS.md "M6 remainder"). Reads only, records nothing:
//
//   Scenario: Zero observations is a real empty state, not a blank screen
//   Scenario: A single observation shows a price with no fabricated trend
//   Scenario: Both levels — an ingredient's blended series and one
//             specific product's own series — are independently reachable
//   Scenario: Currency comes from Settings, never a hardcoded symbol
//
// "rice" is part of the seeded ingredient catalog every fresh workbook gets
// (src/data/seed-catalog.ts) — same fixture id `e2e/m6-barcode-scan.spec.ts`
// already relies on — so these scenarios seed only `PriceObservations`/
// `Products` rows directly through the real `WorkbookStore` contract,
// exactly like that spec's own `seedProduct` helper.

interface SeedObservationInput {
  readonly id: string;
  readonly timestamp: string;
  readonly ingredientId: string;
  readonly amount: number;
  readonly unit: string;
  readonly price: number;
  readonly barcode?: string;
}

async function seedObservation(page: Page, input: SeedObservationInput): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId, input }) => {
      // Intermediate variables, not a string literal directly in `import(...)`
      // — a literal specifier is statically resolved by tsc against Node's
      // module graph (where this browser-only absolute path doesn't exist)
      // and fails the build; a variable is opaque to that check, same
      // pattern `e2e/m6-barcode-scan.spec.ts`'s own seed helpers use.
      const sheetsPath = "/src/sheets/index.ts";
      const domainPath = "/src/domain/index.ts";
      const sheets = await import(sheetsPath);
      const domain = await import(domainPath);
      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      await store.priceObservations.append({
        id: domain.makePriceObservationId(input.id),
        timestamp: domain.makeIsoTimestamp(input.timestamp),
        ingredientId: domain.makeIngredientId(input.ingredientId),
        quantity: { amount: input.amount, unit: input.unit },
        price: input.price,
        ...(input.barcode !== undefined ? { barcode: domain.makeBarcode(input.barcode) } : {}),
      });
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID, input },
  );
}

interface SeedProductInput {
  readonly barcode: string;
  readonly name: string;
  readonly ingredientId: string;
  readonly canonicalAmount: number;
  readonly canonicalUnit: string;
}

/** Same shape as `e2e/m6-barcode-scan.spec.ts`'s own `seedProduct` — kept local rather than shared, matching that spec's own "no shared e2e fixture module" precedent. */
async function seedProduct(page: Page, input: SeedProductInput): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId, input }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const domainPath = "/src/domain/index.ts";
      const sheets = await import(sheetsPath);
      const domain = await import(domainPath);
      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      await store.products.upsert({
        barcode: domain.makeBarcode(input.barcode),
        name: input.name,
        ingredientId: domain.makeIngredientId(input.ingredientId),
        canonicalQuantity: { amount: input.canonicalAmount, unit: input.canonicalUnit },
        displayQuantity: 1,
        displayUnit: "kg",
        shelfLifeDays: 365,
        isBulk: false,
        hasPhoto: false,
      });
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID, input },
  );
}

async function setCurrency(page: Page, currency: string): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId, currency }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const sheets = await import(sheetsPath);
      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      const settings = await store.settings.read();
      await store.settings.write({ ...settings, currency });
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID, currency },
  );
}

test("Price history: zero observations shows a real empty state, not a blank screen", async ({ page }) => {
  await enterReadyShell(page, "products/prices");
  await expect(page.getByRole("heading", { name: "Price history" })).toBeVisible();
  await expect(page.getByText("No prices recorded yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Scan a barcode" })).toBeVisible();
});

/**
 * msw's browser Service Worker only RELAYS requests — the fake in-memory
 * Sheets backend itself lives in this PAGE's own JS realm (`src/mocks/
 * handlers.ts` module state), same as every seed helper's data. A real
 * navigation (`page.goto`/`page.reload`/a second `enterReadyShell` call)
 * tears that realm down and rebuilds it from scratch, silently discarding
 * anything seeded before it — so every scenario below seeds AFTER its one
 * `enterReadyShell` call and only ever moves around afterwards via a real
 * in-app `<Link>` click (client-side React Router navigation, same realm),
 * exactly like `wp-23-shopping-trip.spec.ts`'s own "seed, then click the
 * real nav" pattern. There is no primary-nav entry for this route (task
 * brief: not a top-level nav section), so these dispatch through the two
 * entry points the route actually ships: the ingredient's own pantry page
 * (`PantryItem.tsx`'s "Price history" link) and the price-history list's
 * own internal links.
 */
test("Price history: a single observation shows a price with no fabricated trend", async ({ page }) => {
  await enterReadyShell(page, "pantry/rice");
  await seedObservation(page, {
    id: "obs-single",
    timestamp: "2026-08-10T09:00:00.000Z",
    ingredientId: "rice",
    amount: 1000,
    unit: "g",
    price: 2.4,
  });

  await page.getByRole("link", { name: "Price history" }).click();
  await expect(page.getByRole("heading", { name: "Rice" })).toBeVisible();
  await expect(page.getByText("First price recorded")).toBeVisible();
  await expect(page.getByText("$0.24", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /price history/i }).click();
  await expect(page.getByRole("heading", { name: "Price history" })).toBeVisible();
  await expect(page.getByText("New")).toBeVisible();
  await expect(page.getByText("$0.24 per 100 g · 1 observation")).toBeVisible();
});

test("Price history: both levels are independently reachable for the same underlying data", async ({ page }) => {
  await enterReadyShell(page, "pantry/rice");
  await seedProduct(page, {
    barcode: "8001120000123",
    name: "Riso Gallo Arborio",
    ingredientId: "rice",
    canonicalAmount: 1000,
    canonicalUnit: "g",
  });
  await seedObservation(page, {
    id: "obs-a",
    timestamp: "2026-08-01T09:00:00.000Z",
    ingredientId: "rice",
    amount: 1000,
    unit: "g",
    price: 2.0,
    barcode: "8001120000123",
  });
  await seedObservation(page, {
    id: "obs-b",
    timestamp: "2026-08-15T09:00:00.000Z",
    ingredientId: "rice",
    amount: 1000,
    unit: "g",
    price: 2.4,
    barcode: "8001120000123",
  });

  await page.getByRole("link", { name: "Price history" }).click();
  await expect(page.getByRole("heading", { name: "Rice" })).toBeVisible();

  // Both levels reachable from the ingredient page: the blended series...
  await expect(page.getByRole("link", { name: /Riso Gallo Arborio/ })).toBeVisible(); // "By product" rail

  // ...and the top-level list's own toggle between the two.
  await page.getByRole("link", { name: /price history/i }).click();
  await expect(page.getByRole("heading", { name: "Price history" })).toBeVisible();
  await expect(page.getByText(/2 observations/)).toBeVisible();

  await page.getByRole("radio", { name: "By product" }).click();
  const productLink = page.getByRole("link", { name: /Riso Gallo Arborio/ });
  await expect(productLink).toBeVisible();
  await expect(page.getByText(/▲ 20\.0%/)).toBeVisible();

  await productLink.click();
  await expect(page.getByRole("heading", { name: "Riso Gallo Arborio" })).toBeVisible();
  // exact: true — "Rice" is (amusingly) a case-insensitive substring of the
  // "← Price history" back link too, which Playwright's default substring
  // match would otherwise also count.
  await expect(page.getByRole("link", { name: "Rice", exact: true })).toBeVisible();
});

test("Price history: currency comes from Settings, never a hardcoded symbol", async ({ page }) => {
  await enterReadyShell(page, "pantry/rice");
  await setCurrency(page, "€");
  await seedObservation(page, {
    id: "obs-eur",
    timestamp: "2026-08-10T09:00:00.000Z",
    ingredientId: "rice",
    amount: 1000,
    unit: "g",
    price: 2.4,
  });

  await page.getByRole("link", { name: "Price history" }).click();
  await expect(page.getByText("€0.24", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /price history/i }).click();
  await expect(page.getByText("€0.24 per 100 g · 1 observation")).toBeVisible();
  await expect(page.getByText("$0.24 per 100 g · 1 observation")).toHaveCount(0);
});
