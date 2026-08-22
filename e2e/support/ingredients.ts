import { expect, type Page } from "@playwright/test";
import { TINY_PHOTO_PATH } from "./fixtures.ts";

/** Navigates to the Ingredients catalog via the real UI: Recipes (primary nav) -> the "Ingredients" RouteTabs tab — the only way a person reaches it (there is no standalone "Ingredients" nav link). */
export async function goToIngredients(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipes", exact: true }).click();
  await page.getByRole("tab", { name: "Ingredients", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Ingredients" })).toHaveAttribute("aria-selected", "true");
}

export interface HowYouBuyIt {
  readonly soldAs: "Whole" | "Loose";
  /** Only meaningful for "Whole" — Loose renders no pack-size/container fields at all. */
  readonly packSize?: string;
  readonly containerName?: string;
}

export interface HowYouMeasureIt {
  readonly cupWeightGrams?: string;
  readonly pieceWeightGrams?: string;
}

export interface RichIngredientOptions {
  readonly canonicalUnit?: "g" | "ml" | "piece";
  readonly defaultLocation?: "Pantry" | "Fridge" | "Freezer";
  readonly shelfLifeDays?: string;
  readonly photo?: boolean;
  readonly howYouBuyIt?: HowYouBuyIt;
  readonly howYouMeasureIt?: HowYouMeasureIt;
}

/**
 * Creates a catalog ingredient through the real "Add ingredient" form,
 * exercising every field the task brief calls out: the photo, "How you buy
 * it" (Whole/Loose, pack size, `packLabel`/container name) and "How you
 * measure it" (cup weight, per-piece weight) — both sections start
 * collapsed behind a `"+ ..."` disclosure button (IngredientEditor.tsx) and
 * must be expanded before their fields exist in the DOM at all.
 */
export async function addRichIngredient(page: Page, name: string, options: RichIngredientOptions = {}): Promise<void> {
  await goToIngredients(page);
  await page.getByRole("link", { name: "Add ingredient" }).click();
  await expect(page.getByRole("heading", { name: "Add ingredient" })).toBeVisible();

  await page.getByRole("textbox", { name: "Name" }).fill(name);

  if (options.photo) {
    await page.locator('input[type="file"]').first().setInputFiles(TINY_PHOTO_PATH);
    await expect(page.getByRole("button", { name: "Replace" })).toBeVisible();
  }

  if (options.canonicalUnit) {
    await page.getByRole("radiogroup", { name: "Canonical unit" }).getByRole("radio", { name: options.canonicalUnit }).click();
  }
  if (options.defaultLocation) {
    await page
      .getByRole("radiogroup", { name: "Default storage location" })
      .getByRole("radio", { name: options.defaultLocation })
      .click();
  }
  if (options.shelfLifeDays) {
    // exact: true — "Shelf life (days)" is otherwise an ambiguous substring
    // match against the also-present "Opened shelf life (days)" field.
    await page.getByRole("textbox", { name: "Shelf life (days)", exact: true }).fill(options.shelfLifeDays);
  }

  if (options.howYouBuyIt) {
    await page.getByRole("button", { name: "+ How you buy it" }).click();
    await page
      .getByRole("radiogroup", { name: "Sold as" })
      .getByRole("radio", { name: options.howYouBuyIt.soldAs })
      .click();
    if (options.howYouBuyIt.soldAs === "Whole") {
      if (options.howYouBuyIt.packSize) {
        await page.getByRole("textbox", { name: /^Pack size/ }).fill(options.howYouBuyIt.packSize);
      }
      if (options.howYouBuyIt.containerName) {
        await page.getByRole("textbox", { name: "Container name (optional)" }).fill(options.howYouBuyIt.containerName);
      }
    }
  }

  if (options.howYouMeasureIt) {
    await page.getByRole("button", { name: "+ How you measure it" }).click();
    if (options.howYouMeasureIt.cupWeightGrams) {
      await page.getByRole("textbox", { name: "1 cup weighs (g)" }).fill(options.howYouMeasureIt.cupWeightGrams);
    }
    if (options.howYouMeasureIt.pieceWeightGrams) {
      await page.getByRole("textbox", { name: /^1 .+ weighs \(g\)$/ }).fill(options.howYouMeasureIt.pieceWeightGrams);
    }
  }

  await page.getByRole("button", { name: "Save ingredient" }).click();
  await expect(page.getByRole("heading", { name: "Add ingredient" })).toHaveCount(0);
}
