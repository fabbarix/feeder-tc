import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { saveRecipeThroughNudges } from "./support/recipes.ts";

// WP-PHOTO UI: the user-facing half of WP-PHOTO's contract/pipeline (merged,
// but with zero UI before this package). Covers: the RecipeEditor
// round-trip fix (a step's detail/duration/photo surviving an untouched
// re-save — src/routes/RecipeEditor.test.tsx proves this at the unit level
// against a fake store; this proves it end-to-end through the real
// route/UI), adding a photo to a recipe/step/ingredient, the running timer
// starting, and the zero-photo placeholder being the default look, not a
// broken/missing one.
//
// A real 1x1 PNG fixture feeds every upload here — `e2e/wp-photo-encoder.spec.ts`
// already proves the encoder's byte-budget behaviour against a genuinely
// noisy, oversized source; this suite is about the UI wiring around it, not
// the encoder itself, so a trivial source image keeps every upload here fast.
const TINY_PNG = fileURLToPath(new URL("./support/fixtures/tiny.png", import.meta.url));

test("A recipe photo, and a step's detail + duration + photo, save and survive an untouched re-edit", async ({ page }) => {
  await enterReadyShell(page, "recipes");
  await page.getByRole("link", { name: "Add recipe" }).click();
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();

  await page.getByRole("textbox", { name: "Name" }).fill("Chili E2E");
  await page.getByRole("textbox", { name: "Cook time" }).fill("30");

  // The recipe's own photo — the Identity card's file input is the first on
  // the page.
  await page.locator('input[type="file"]').nth(0).setInputFiles(TINY_PNG);
  await expect(page.getByRole("button", { name: "Replace" }).first()).toBeVisible();

  // One step card by default: instruction, duration, photo, detail.
  await page.getByRole("textbox", { name: "Instruction" }).fill("Simmer until thick");
  const durationField = page.getByRole("textbox", { name: "Duration" });
  await durationField.fill("20");
  await page.locator('input[type="file"]').nth(1).setInputFiles(TINY_PNG);
  await page
    .getByRole("textbox", { name: /detail/i })
    .fill("Stir every 5 minutes so it doesn't catch on the bottom of the pan.");

  // Save navigates back to the Recipes list (RecipeEditor.tsx), not
  // straight to the new recipe's own page — open it from its card.
  await saveRecipeThroughNudges(page);
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
  await page.getByRole("link", { name: "Chili E2E" }).click();
  await expect(page.getByRole("heading", { name: "Chili E2E" })).toBeVisible();

  // Rendered live on the read view: duration badge + Start timer, the step
  // photo, and the detail disclosure (closed by default).
  await expect(page.getByText("Simmer until thick")).toBeVisible();
  await expect(page.getByText("20 min")).toBeVisible();
  const startTimerButton = page.getByRole("button", { name: "Start timer" });
  await expect(startTimerButton).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(2); // recipe inset + step image
  await expect(page.getByText("Stir every 5 minutes")).not.toBeVisible();
  // The disclosure's "Show detail ▾"/"Hide detail ▴" label is CSS-generated
  // content (`::before`), not real DOM text, so click the <summary> itself
  // rather than searching for that text.
  await page.locator("details summary").click();
  await expect(page.getByText("Stir every 5 minutes")).toBeVisible();

  // The running timer: full accent bar, mm:ss countdown, Pause/Cancel.
  await startTimerButton.click();
  await expect(page.getByText(/^\d+:\d{2}$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause timer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel timer" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel timer" }).click();
  await expect(startTimerButton).toBeVisible();

  // Round-trip regression (A): re-open the editor, change NOTHING, save
  // again — detail/duration/photo must all still be there afterwards, both
  // in the editor's own fields and back on the read view.
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit recipe" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Duration" })).toHaveValue("20");
  await expect(page.getByRole("textbox", { name: /detail/i })).toHaveValue(
    "Stir every 5 minutes so it doesn't catch on the bottom of the pan.",
  );
  // Both photos already show their Replace/Remove state (previews loaded),
  // not the dashed "Add" affordance — proof the existing photos round-tripped.
  await expect(page.getByRole("button", { name: "Replace" })).toHaveCount(2);

  await saveRecipeThroughNudges(page);
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();

  // The Recipes grid card now shows a real photo, not the placeholder glyph.
  const card = page.getByRole("link", { name: /Chili E2E/ });
  await expect(card.locator("img")).toBeVisible();

  await card.click();
  await expect(page.getByRole("heading", { name: "Chili E2E" })).toBeVisible();
  await expect(page.getByText("Simmer until thick")).toBeVisible();
  await expect(page.getByText("20 min")).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(2);
});

test("Adding a photo to an ingredient shows it in the Ingredients list", async ({ page }) => {
  await enterReadyShell(page, "recipes/ingredients");
  await page.getByRole("link", { name: "Add ingredient" }).click();
  await expect(page.getByRole("heading", { name: "Add ingredient" })).toBeVisible();

  await page.getByRole("textbox", { name: "Name" }).fill("Photographed Flour");
  await page.locator('input[type="file"]').first().setInputFiles(TINY_PNG);
  await expect(page.getByRole("button", { name: "Replace" })).toBeVisible();
  await page.getByRole("textbox", { name: /Shelf life/ }).fill("180");
  await page.getByRole("textbox", { name: /Opened shelf life/ }).fill("30");
  await page.getByRole("button", { name: "Save ingredient" }).click();

  await expect(page.getByRole("tab", { name: "Ingredients" })).toBeVisible();
  // The search filters the list to this one ingredient alone (its name is
  // unique in the catalog), so a page-wide image check is unambiguous.
  await page.getByRole("textbox", { name: "Search" }).fill("Photographed Flour");
  await expect(page.getByRole("link", { name: "Photographed Flour" })).toBeVisible();
  await expect(page.locator("main img")).toBeVisible();
});

test("A zero-photo ingredient shows the calm placeholder glyph, never a photo or a broken-image look", async ({ page }) => {
  await enterReadyShell(page, "recipes/ingredients");
  await expect(page.getByRole("tab", { name: "Ingredients" })).toBeVisible();
  // "Onion" ships in the seeded catalog (src/data/seed-catalog.ts) with no
  // photo — the day-one normal for all 104 seeded ingredients
  // (DESIGN_PHOTOS.md §6), not a rare/edge case.
  await page.getByRole("textbox", { name: "Search" }).fill("Onion");
  const onionLink = page.getByRole("link", { name: "Onion" });
  await expect(onionLink).toBeVisible();
  // Filtered to this one row alone — no photo anywhere on the page (never a
  // broken-image attempt). The row itself (three ancestors up from the
  // name link: link -> ListRow's `.primary` -> `.text` -> `.row`) still
  // shows the calm placeholder glyph in its leading slot, not an empty box.
  await expect(page.locator("main img")).toHaveCount(0);
  const row = onionLink.locator("..").locator("..").locator("..");
  await expect(row.locator("svg")).toBeVisible();
});
