import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// IMPLEMENTATION_PLAN.md WP-21, `@e2e`:
//
// Feature: Pantry management
//   Scenario: Adding existing pantry stock
//     When the user adds 500 g of rice located in the pantry
//     Then the pantry shows a rice lot of 500 g with expiry from catalog defaults
//
//   Scenario: Expiring items are surfaced
//     Given a lot of milk expiring in 2 days
//     Then the pantry view lists milk under "Expiring soon"

async function openIngredientSheet(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: /ingredient/i }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

/** Clicks the day-of-month cell in the currently-open React Aria calendar, advancing months first if `target` isn't in the visible (current) month. */
async function pickCalendarDate(page: Page, target: Date): Promise<void> {
  const now = new Date();
  const monthsAhead = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  for (let i = 0; i < monthsAhead; i += 1) {
    await page.getByRole("button", { name: "Next month" }).click();
  }
  await page.getByRole("button", { name: new RegExp(`\\b${target.getDate()}\\b`) }).click();
}

function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

test("Adding existing pantry stock", async ({ page }) => {
  // When the user adds 500 g of rice located in the pantry
  await enterReadyShell(page, "pantry");
  await expect(page.getByRole("heading", { name: "Pantry", level: 1 })).toBeVisible();

  // Empty pantry -> EmptyState's own "Add to pantry" action (only one such
  // control is ever on screen at once — see Pantry.tsx).
  await page.getByRole("button", { name: "Add to pantry" }).click();

  await openIngredientSheet(page, "Rice");
  await page.getByRole("textbox", { name: /amount/i }).fill("500");
  // Rice's catalog default location is "pantry" already; select it
  // explicitly so the scenario's "located in the pantry" is asserted, not
  // just inherited silently from the catalog default.
  await page.getByRole("radio", { name: "Pantry" }).click();

  await page.getByRole("button", { name: "Add to pantry" }).click();

  // Then the pantry shows a rice lot of 500 g with expiry from catalog defaults
  await expect(page.getByRole("heading", { name: "Rice" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("500 g");
  await expect(page.getByRole("main")).toContainText("Pantry");
  // Rice's catalog shelf_life_days is 730 — the row must show a computed
  // expiry, not a blank/placeholder value.
  await expect(page.getByRole("main")).toContainText(/Expires in \d+ days?/);
});

test("Expiring items are surfaced", async ({ page }) => {
  // Given a lot of milk expiring in 2 days
  await enterReadyShell(page, "pantry");
  await page.getByRole("button", { name: "Add to pantry" }).click();

  await openIngredientSheet(page, "Milk");
  await page.getByRole("textbox", { name: /amount/i }).fill("500");

  const expiryGroup = page.getByRole("group", { name: /expiry override/i });
  await expiryGroup.getByRole("button", { name: /pick/i }).click();
  await pickCalendarDate(page, addDays(2));

  await page.getByRole("button", { name: "Add to pantry" }).click();

  // Then the pantry view lists milk under "Expiring soon"
  const expiringHeading = page.getByRole("heading", { name: "Expiring soon" });
  await expect(expiringHeading).toBeVisible();
  const expiringSection = expiringHeading.locator("xpath=..");
  await expect(expiringSection).toContainText("Milk");
});

test("Manual usage records a use event FIFO, with no lot picker", async ({ page }) => {
  await enterReadyShell(page, "pantry");
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await openIngredientSheet(page, "Rice");
  await page.getByRole("textbox", { name: /amount/i }).fill("1000");
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await expect(page.getByRole("main")).toContainText("1000 g");

  // "Record usage" only ever asks for an ingredient and an amount — there is
  // no lot selector, because FIFO resolves which lot(s) at fold time.
  await page.getByRole("button", { name: "Record usage" }).click();
  await expect(page.getByRole("button", { name: /ingredient/i })).toBeVisible();
  await openIngredientSheet(page, "Rice");
  await page.getByRole("textbox", { name: /amount used/i }).fill("300");
  await page.getByRole("button", { name: "Record usage" }).click();

  await expect(page.getByRole("main")).toContainText("700 g");
});

test("Lot actions: move, open, correct (never 'Edit'), and spoil", async ({ page }) => {
  await enterReadyShell(page, "pantry");
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await openIngredientSheet(page, "Rice");
  await page.getByRole("textbox", { name: /amount/i }).fill("1000");
  await page.getByRole("radio", { name: "Pantry" }).click();
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await expect(page.getByRole("main")).toContainText("1000 g");

  // Move: pantry -> fridge.
  await page.getByRole("button", { name: "Move" }).click();
  await page.getByRole("radio", { name: "Fridge" }).click();
  await page.getByRole("button", { name: "Confirm move" }).click();
  await expect(page.getByRole("main")).toContainText("Fridge");

  // Open: shortens shelf life to the opened default; no lot delete, no "Edit".
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Mark opened" }).click();
  await expect(page.getByRole("main")).toContainText(/opened \d{4}-\d{2}-\d{2}/);

  // Correct — never "Edit" (invariant 1): a manual quantity + expiry
  // correction, recorded as a brand-new `adjust` event.
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await page.getByRole("button", { name: "Correct" }).click();
  await page.getByRole("textbox", { name: /adjust amount by/i }).fill("-100");
  const expiryGroup = page.getByRole("group", { name: /new expiry/i });
  await expiryGroup.getByRole("button", { name: "+1w" }).click();
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("main")).toContainText("900 g");

  // Spoil — names this specific lot; the dialog defaults to the full
  // remaining amount, editable for a partial loss.
  await page.getByRole("button", { name: "Spoil" }).click();
  await page.getByRole("textbox", { name: /amount/i }).fill("100");
  await page.getByRole("button", { name: "Mark spoiled" }).click();
  await expect(page.getByRole("main")).toContainText("800 g");
});
