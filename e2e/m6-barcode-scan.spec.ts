import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { E2E_CREATED_SPREADSHEET_ID, E2E_FAKE_ACCESS_TOKEN } from "../src/mocks/handlers.ts";

// M6 (DESIGN_PRODUCTS.md §1), `@e2e`:
//
// Feature: Barcode scan
//   Scenario: An unknown barcode creates a product and adds it to the pantry
//   Scenario: A known packaged barcode updates the shopping list
//   Scenario: A known bulk barcode asks for the weight every time
//   Scenario: A price observation is recorded alongside a purchase
//   Scenario: No camera / permission denied falls back to manual entry, never a dead end
//
// Camera/`BarcodeDetector` access is stubbed to fail in every scenario below
// (headless CI has no real camera and no fake-video-device rig wired up for
// this suite) — every scenario therefore drives the barcode through the
// ALWAYS-PRESENT manual-entry field, which is both the deterministic thing
// to assert against and the exact fallback path DESIGN_PRODUCTS.md §1 asks
// for ("never a dead end"). The dedicated camera-failure tests at the bottom
// assert the two distinct failure messages (denied vs. no camera) on top of
// that same stub.

async function stubCamera(page: Page, errorName: "NotFoundError" | "NotAllowedError"): Promise<void> {
  await page.addInitScript((name) => {
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException("stubbed for E2E — no real camera in CI", name)),
      },
    });
  }, errorName);
}

interface SeedProductInput {
  readonly barcode: string;
  readonly name: string;
  readonly ingredientId: string;
  readonly canonicalAmount: number;
  readonly canonicalUnit: string;
  readonly displayQuantity: number;
  readonly displayUnit: string;
  readonly shelfLifeDays: number;
  readonly isBulk: boolean;
}

/** Seeds one `Products` row through the real `WorkbookStore` contract, same non-literal-import-path trick as `e2e/wp-23-shopping-trip.spec.ts`'s `seedRicePlanForThisWeek`. */
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
        displayQuantity: input.displayQuantity,
        displayUnit: input.displayUnit,
        shelfLifeDays: input.shelfLifeDays,
        isBulk: input.isBulk,
        hasPhoto: false,
      });
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID, input },
  );
}

/** Seeds a recipe + today's `PlanSlot` needing 400 g of rice — a live "this week" shopping need for the known-packaged-barcode scenario. */
async function seedRiceNeedForToday(page: Page): Promise<void> {
  await page.evaluate(
    async ({ token, spreadsheetId }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const domainPath = "/src/domain/index.ts";
      const sheets = await import(sheetsPath);
      const domain = await import(domainPath);

      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      const rng = domain.createSeededRng(2);

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
        { recipeId, ingredientId: domain.makeIngredientId("rice"), quantity: { amount: 400, unit: "g" } },
      ]);
      await store.planSlots.upsert({
        id: domain.newPlanSlotId(rng),
        date: domain.systemClock.today(),
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

async function readPriceObservations(page: Page): Promise<readonly { barcode?: string; price: number }[]> {
  return page.evaluate(
    async ({ token, spreadsheetId }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const sheets = await import(sheetsPath);
      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      const result = await store.priceObservations.readAll();
      return result.rows.map((r: { barcode?: string; price: number }) => ({ barcode: r.barcode, price: r.price }));
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID },
  );
}

test("Scan: an unknown barcode opens the product editor and creates a product + pantry lot + price", async ({ page }) => {
  await stubCamera(page, "NotFoundError");
  await enterReadyShell(page, "scan");
  await expect(page.getByRole("heading", { name: "Scan a barcode" })).toBeVisible();

  // No camera in CI — the manual barcode field must still be right there.
  await expect(page.getByText("No camera was found on this device.")).toBeVisible();

  const barcode = "8001120000123";
  await page.getByLabel("Enter barcode manually").fill(barcode);
  await page.getByRole("button", { name: "Look up" }).click();

  // Unknown barcode -> the product editor (DESIGN_PRODUCTS.md §1.2).
  await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();
  await expect(page.getByText(barcode)).toBeVisible();

  await page.getByLabel("Name").fill("Riso Gallo Arborio 1 kg");
  await page.getByRole("button", { name: /which ingredient is this/i }).click();
  await page.getByRole("textbox", { name: /search ingredient/i }).fill("Rice");
  await page.getByRole("option", { name: "Rice" }).click();

  await page.getByLabel(/package content/i).fill("1000");
  await page.getByRole("button", { name: "+ Record the price you paid" }).click();
  await page.getByLabel(/price paid/i).fill("2.49");

  await page.getByRole("button", { name: "Save & add to pantry" }).click();

  // Back to the scanning screen once saved (no dead-end panel left open).
  await expect(page.getByLabel("Enter barcode manually")).toBeVisible();
  await expect(page.getByRole("heading", { name: "New product" })).toHaveCount(0);

  const observations = await readPriceObservations(page);
  expect(observations.some((o) => o.barcode === barcode && o.price === 2.49)).toBe(true);
});

test("Scan: a known packaged barcode defaults to the shopping list's need, one tap to confirm", async ({ page }) => {
  await stubCamera(page, "NotFoundError");
  await enterReadyShell(page, "scan");
  await seedRiceNeedForToday(page);
  await seedProduct(page, {
    barcode: "0000000000021",
    name: "Riso Gallo Arborio 1 kg",
    ingredientId: "rice",
    canonicalAmount: 1000,
    canonicalUnit: "g",
    displayQuantity: 1,
    displayUnit: "kg",
    shelfLifeDays: 365,
    isBulk: false,
  });

  await page.getByLabel("Enter barcode manually").fill("0000000000021");
  await page.getByRole("button", { name: "Look up" }).click();

  // Known barcode with a live need -> "Mark bought", pre-filled with the
  // need (400 g), no typing required for the common case (requirement 1).
  await expect(page.getByRole("heading", { name: /mark riso gallo arborio 1 kg bought/i })).toBeVisible();
  await expect(page.getByText("400 g")).toBeVisible();

  await page.getByRole("button", { name: "Mark bought" }).click();
  await expect(page.getByLabel("Enter barcode manually")).toBeVisible();
});

test("Scan: 'bought a different amount' reveals a stepper and the surplus is never styled as an error", async ({
  page,
}) => {
  await stubCamera(page, "NotFoundError");
  await enterReadyShell(page, "scan");
  await seedRiceNeedForToday(page);
  await seedProduct(page, {
    barcode: "0000000000038",
    name: "Riso Gallo Arborio 1 kg",
    ingredientId: "rice",
    canonicalAmount: 1000,
    canonicalUnit: "g",
    displayQuantity: 1,
    displayUnit: "kg",
    shelfLifeDays: 365,
    isBulk: false,
  });

  await page.getByLabel("Enter barcode manually").fill("0000000000038");
  await page.getByRole("button", { name: "Look up" }).click();

  await page.getByRole("button", { name: "Bought a different amount?" }).click();
  const amountField = page.getByRole("textbox", { name: /quantity bought/i });
  await expect(amountField).toBeVisible();
  await amountField.fill("1000");

  await expect(page.getByText(/more than needed.*extra goes straight into the pantry/i)).toBeVisible();

  await page.getByRole("button", { name: "Mark bought" }).click();
  await expect(page.getByLabel("Enter barcode manually")).toBeVisible();
});

test("Scan: a known bulk barcode always asks for the weight, using the same stepper control", async ({ page }) => {
  await stubCamera(page, "NotFoundError");
  await enterReadyShell(page, "scan");
  await seedProduct(page, {
    barcode: "0000000000045",
    name: "Loose almonds",
    ingredientId: "rice", // reusing the seeded "rice" ingredient id purely as a stand-in canonical-g ingredient for this bulk scenario
    canonicalAmount: 1,
    canonicalUnit: "g",
    displayQuantity: 1,
    displayUnit: "g",
    shelfLifeDays: 200,
    isBulk: true,
  });

  await page.getByLabel("Enter barcode manually").fill("0000000000045");
  await page.getByRole("button", { name: "Look up" }).click();

  await expect(page.getByRole("heading", { name: /add loose almonds to pantry/i })).toBeVisible();
  // Bulk: no default shown, no "confirm at a glance" button — the amount
  // field is open immediately (DESIGN_PRODUCTS.md §1.3 + the coordinator's
  // variable-weight requirement 4).
  const amountField = page.getByRole("textbox", { name: /^amount/i });
  await expect(amountField).toBeVisible();
  await amountField.fill("340");

  await page.getByRole("button", { name: "Add to pantry" }).click();
  await expect(page.getByLabel("Enter barcode manually")).toBeVisible();
});

test("Scan: camera permission denied falls back to manual entry, never a dead end", async ({ page }) => {
  await stubCamera(page, "NotAllowedError");
  await enterReadyShell(page, "scan");
  await expect(page.getByText("Camera access was denied.")).toBeVisible();
  await expect(page.getByLabel("Enter barcode manually")).toBeVisible();
  await expect(page.getByRole("button", { name: "Look up" })).toBeVisible();
});

test("Scan: no camera on the device falls back to manual entry, never a dead end", async ({ page }) => {
  await stubCamera(page, "NotFoundError");
  await enterReadyShell(page, "scan");
  await expect(page.getByText("No camera was found on this device.")).toBeVisible();
  await expect(page.getByLabel("Enter barcode manually")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try the camera again" })).toBeVisible();
});
