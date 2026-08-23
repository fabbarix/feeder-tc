import { expect, type Page } from "@playwright/test";
import { E2E_CREATED_SPREADSHEET_ID, E2E_FAKE_ACCESS_TOKEN } from "../../src/mocks/handlers.ts";

/**
 * Headless CI has no real camera — every scan scenario drives the barcode
 * through the always-present manual-entry field instead (DESIGN_PRODUCTS.md
 * §1's own "never a dead end" fallback requirement), same stub
 * `e2e/m6-barcode-scan.spec.ts` already uses. Must be added BEFORE the page
 * first navigates to `/scan` (an `addInitScript` applies to every
 * navigation from the point it's registered, not retroactively), so call
 * this at the very start of a journey test, before `enterReadyShell`.
 */
export async function stubCamera(page: Page, errorName: "NotFoundError" | "NotAllowedError" = "NotFoundError"): Promise<void> {
  await page.addInitScript((name) => {
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException("stubbed for E2E — no real camera in CI", name)),
      },
    });
  }, errorName);
}

/** Seeds one `Products` row through the real `WorkbookStore` contract, same shape as `e2e/m6-barcode-scan.spec.ts`'s own `seedProduct`. */
export async function seedProduct(
  page: Page,
  input: {
    readonly barcode: string;
    readonly name: string;
    readonly ingredientId: string;
    readonly canonicalAmount: number;
    readonly canonicalUnit: string;
    readonly displayQuantity: number;
    readonly displayUnit: string;
    readonly shelfLifeDays: number;
    readonly isBulk: boolean;
  },
): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId, input }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const domainPath = "/src/domain/index.ts";
      const sheets = await import(sheetsPath);
      const domain = await import(domainPath);
      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      // WP-PRODUCTS-MODEL: identity is now ProductId, not barcode — see
      // e2e/m6-barcode-scan.spec.ts's own seedProduct for the same fix.
      const rng = domain.createSeededRng(7);
      const productId = domain.newProductId(rng);
      const barcode = domain.makeBarcode(input.barcode);
      await store.products.upsert({
        id: productId,
        name: input.name,
        ingredientId: domain.makeIngredientId(input.ingredientId),
        canonicalQuantity: { amount: input.canonicalAmount, unit: input.canonicalUnit },
        displayQuantity: input.displayQuantity,
        displayUnit: input.displayUnit,
        shelfLifeDays: input.shelfLifeDays,
        isBulk: input.isBulk,
        hasPhoto: false,
      });
      await store.productBarcodes.upsert({ productId, barcode });
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID, input },
  );
}

export async function enterBarcode(page: Page, barcode: string): Promise<void> {
  await page.getByLabel("Enter barcode manually").fill(barcode);
  await page.getByRole("button", { name: "Look up" }).click();
}

/**
 * The unknown-barcode path (DESIGN_PRODUCTS.md §1.2): the product editor
 * opens with the scanned barcode pre-filled, and a price observation is
 * optional but exercised here since the task brief calls it out ("recording
 * a price") explicitly.
 *
 * `packageContentUnit` matters and must be passed explicitly: selecting an
 * ingredient resets the "Package unit" `SegmentedControl` to that
 * ingredient's own catalog-preferred entry unit (`ProductEditorPanel.tsx`'s
 * `selectIngredient` — `scan-options.ts`'s `ENTRY_UNITS_BY_CANONICAL` puts
 * "kg" first for any gram-canonical ingredient, e.g. Rice), NOT to whatever
 * unit the field happened to show before that click. Filling "1000" while
 * the control silently sits on "kg" records a 1,000,000 g observation
 * instead of 1000 g — a real trap this helper closes by always clicking the
 * unit explicitly rather than assuming a default.
 */
export async function createUnknownProduct(
  page: Page,
  input: {
    readonly barcode: string;
    readonly name: string;
    readonly ingredientName: string;
    readonly packageContentAmount: string;
    readonly packageContentUnit: "kg" | "g" | "lb" | "oz" | "l" | "ml" | "fl oz" | "piece";
    readonly price: string;
  },
): Promise<void> {
  await enterBarcode(page, input.barcode);
  await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();
  await page.getByLabel("Name").fill(input.name);
  await page.getByRole("button", { name: /which ingredient is this/i }).click();
  await page.getByRole("textbox", { name: /search ingredient/i }).fill(input.ingredientName);
  await page.getByRole("option", { name: input.ingredientName, exact: true }).click();
  await page.getByRole("radiogroup", { name: "Package unit" }).getByRole("radio", { name: input.packageContentUnit, exact: true }).click();
  await page.getByLabel(/package content/i).fill(input.packageContentAmount);
  await page.getByRole("button", { name: "+ Record the price you paid" }).click();
  await page.getByLabel(/price paid/i).fill(input.price);
  await page.getByRole("button", { name: "Save & add to pantry" }).click();
  await expect(page.getByLabel("Enter barcode manually")).toBeVisible();
}

/** The known-BULK-barcode path (DESIGN_PRODUCTS.md §1.3): always asks for the weight, no default/"confirm at a glance" shortcut. */
export async function scanBulkProduct(page: Page, barcode: string, weightGrams: string): Promise<void> {
  await enterBarcode(page, barcode);
  const amountField = page.getByRole("textbox", { name: /^amount/i });
  await expect(amountField).toBeVisible();
  await amountField.fill(weightGrams);
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await expect(page.getByLabel("Enter barcode manually")).toBeVisible();
}
