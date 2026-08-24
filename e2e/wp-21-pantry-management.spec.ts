import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { E2E_CREATED_SPREADSHEET_ID, E2E_FAKE_ACCESS_TOKEN } from "../src/mocks/handlers.ts";

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

/**
 * Clicks the day-of-month cell in the currently-open React Aria calendar,
 * advancing months first if `target` isn't in the visible (current) month.
 *
 * React Aria's `useCalendarCell` gives every cell's button a full,
 * unambiguous `aria-label` — e.g. "Wednesday, August 26, 2026" — including
 * the (hidden, `aria-disabled`) spill-over cells that belong to the
 * adjacent month but render in the visible grid's leading/trailing rows.
 * Matching on the day number alone (`/\b26\b/`) is therefore only correct
 * on dates where no such spill-over cell shares the target's day number;
 * whenever one does, strict mode fails on two matches. Match the full
 * label instead so exactly one cell — the target date, in the target
 * month/year — ever matches, regardless of what's spilling over.
 */
async function pickCalendarDate(page: Page, target: Date): Promise<void> {
  const now = new Date();
  const monthsAhead =
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  for (let i = 0; i < monthsAhead; i += 1) {
    await page.getByRole("button", { name: "Next month" }).click();
  }
  const label = target.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  await page.getByRole("button", { name: label, exact: true }).click();
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
  // just inherited silently from the catalog default. Scoped to the FIRST
  // "Location" radiogroup (DOM order: the add-lot form's own control, in
  // `.main`, precedes the FILTERS rail's identically-labelled one in
  // `.rail` — WP-VC4 added that second control, so an unscoped `radio`
  // query now matches two "Pantry" options).
  await page.getByRole("radiogroup", { name: "Location" }).first().getByRole("radio", { name: "Pantry" }).click();

  await page.getByRole("button", { name: "Add to pantry" }).click();

  // Then the pantry shows a rice lot of 500 g with expiry from catalog
  // defaults — as ONE aggregated row (WP-VC4: one row per ingredient, not
  // one row per lot), which links to its own pantry-item detail route.
  const riceRow = page.getByRole("link", { name: /Rice/ });
  await expect(riceRow).toBeVisible();
  await expect(page.getByRole("main")).toContainText("500 g");
  await expect(page.getByRole("main")).toContainText("Pantry");
  // Rice's catalog shelf_life_days is 730 — the row must show a computed
  // expiry, not a blank/placeholder value.
  await expect(page.getByRole("main")).toContainText(/Expires/);

  await riceRow.click();
  await expect(page.getByRole("heading", { name: "Rice", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("500 g");
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

// WP-VC4: the four lot-scoped actions moved off the pantry LIST page onto
// the pantry-item DETAIL route (`/pantry/:ingredientId`, "Record an event"
// rail) — this scenario now navigates into Rice's own page first, same as
// a person following the aggregated row's link would.
test("Lot actions: move, open, correct (never 'Edit'), and spoil", async ({ page }) => {
  await enterReadyShell(page, "pantry");
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await openIngredientSheet(page, "Rice");
  await page.getByRole("textbox", { name: /amount/i }).fill("1000");
  // Scoped to the first "Location" radiogroup — see the identical comment
  // on "Adding existing pantry stock" above.
  await page.getByRole("radiogroup", { name: "Location" }).first().getByRole("radio", { name: "Pantry" }).click();
  await page.getByRole("button", { name: "Add to pantry" }).click();

  await page.getByRole("link", { name: /Rice/ }).click();
  await expect(page.getByRole("heading", { name: "Rice", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("1000 g");

  // Move: pantry -> fridge.
  await page.getByRole("button", { name: "Move location" }).click();
  await page.getByRole("radio", { name: "Fridge" }).click();
  await page.getByRole("button", { name: "Confirm move" }).click();
  await expect(page.getByRole("main")).toContainText("Fridge");

  // Open: shortens shelf life to the opened default; no lot delete, no "Edit".
  await page.getByRole("button", { name: "Open a lot" }).click();
  await page.getByRole("button", { name: "Mark opened" }).click();
  await expect(page.getByRole("main")).toContainText(/opened \d{1,2} \w+/);

  // Correct — never "Edit" (invariant 1): a manual quantity + expiry
  // correction, recorded as a brand-new `adjust` event.
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await page.getByRole("button", { name: "Correct quantity or expiry" }).click();
  await page.getByRole("textbox", { name: /adjust amount by/i }).fill("-100");
  const expiryGroup = page.getByRole("group", { name: /new expiry/i });
  await expiryGroup.getByRole("button", { name: "+1w" }).click();
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("main")).toContainText("900 g");

  // Spoil — names this specific lot; the dialog defaults to the full
  // remaining amount, editable for a partial loss. The rail's opener button
  // and the dialog's own confirm button carry deliberately distinct
  // accessible names ("Mark spoiled" vs "Confirm spoilage") — ConfirmDialog
  // doesn't hide the page behind it, so two controls both named "Mark
  // spoiled" at once would be ambiguous for a screen-reader user.
  await page.getByRole("button", { name: "Mark spoiled" }).click();
  await page.getByRole("textbox", { name: /amount/i }).fill("100");
  await page.getByRole("button", { name: "Confirm spoilage" }).click();
  await expect(page.getByRole("main")).toContainText("800 g");
});

// Regression (fix-ua-integrity): a usability review reported that
// "Correct quantity or expiry" updates the LOTS card's quantity but the
// HISTORY card below keeps showing only the events recorded before the
// correction — as if the correction never happened. The dialog promises
// "This adds a correction on top of the history rather than changing what
// was already recorded" (invariant 1: `InventoryEvents` rows are immutable,
// a correction is a new `adjust` event, never an edit).
//
// Root cause turned out to be `PantryItem.tsx`'s History panel fetching
// `store.inventoryEvents.readFrom(0)` exactly once, in a `useEffect` keyed
// only on `[store]` — so the panel never re-read the sheet after any
// action taken on THIS page (correct, use, open, move, spoil), including
// the very correction the test below performs. The write itself was never
// the problem (the event landed in `InventoryEvents` correctly, invariant 1
// intact) — only the read that renders History was stale.
//
// This asserts the property that actually broke: that the just-recorded
// `adjust` event becomes VISIBLE in the History list, in the same page
// session, with no reload — not merely that the Lots card's number changed
// (which was already correct even with the bug, and would make a
// weaker assertion pass on unfixed code).
test("Correcting a lot immediately surfaces the correction in History (no reload)", async ({ page }) => {
  await enterReadyShell(page, "pantry");
  await page.getByRole("button", { name: "Add to pantry" }).click();
  await openIngredientSheet(page, "Tomato");
  await page.getByRole("textbox", { name: /amount/i }).fill("400");
  await page.getByRole("button", { name: "Add to pantry" }).click();

  await page.getByRole("link", { name: /Tomato/ }).click();
  await expect(page.getByRole("heading", { name: "Tomato", level: 1 })).toBeVisible();

  // Before correcting: History shows only the original purchase — this is
  // the reviewer's own "three events" framing, minimised to the one event
  // this test actually needs.
  await expect(page.getByText(/purchased 400/i)).toBeVisible();
  await expect(page.getByText(/corrected/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Correct quantity or expiry" }).click();
  await page.getByRole("textbox", { name: /adjust amount by/i }).fill("-50");
  await page.getByRole("button", { name: "Save correction" }).click();

  // The Lots card updating was never in doubt (the reviewer saw this part
  // work) — the bug was specifically that History stayed frozen.
  await expect(page.getByRole("main")).toContainText("350 g");
  await expect(page.getByText(/corrected — adjusted -50/i)).toBeVisible();

  // And it isn't just the screen: the immutable event genuinely landed in
  // `InventoryEvents` as a NEW row (invariant 1) — the original purchase
  // event is untouched, sitting alongside the new `adjust` event, not
  // replaced by it.
  const rows = await page.evaluate(
    async ({ token, spreadsheetId }) => {
      const sheetsPath = "/src/sheets/index.ts";
      const sheets = await import(sheetsPath);
      const auth = { getAccessToken: () => Promise.resolve(token), invalidate: () => undefined };
      const transport = sheets.createGoogleSheetsTransport({ spreadsheetId, auth });
      const store = sheets.createSheetsWorkbookStore(transport);
      const page1 = await store.inventoryEvents.readFrom(0);
      return page1.rows.filter((r: { ingredientId: string }) => r.ingredientId === "tomato");
    },
    { token: E2E_FAKE_ACCESS_TOKEN, spreadsheetId: E2E_CREATED_SPREADSHEET_ID },
  );
  expect(rows).toHaveLength(2);
  expect(rows.map((r: { type: string }) => r.type).sort()).toEqual(["adjust", "purchase"]);
});
