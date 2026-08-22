import { expect, type Page } from "@playwright/test";
import { TINY_PHOTO_PATH } from "./fixtures.ts";

/**
 * Adds a minimal cooked recipe through the real "Add recipe" flow — name and
 * cook time only, no ingredient lines or steps, which is all any spec using
 * this needs. Shared by every spec that just needs "a recipe exists" as
 * setup (previously copy-pasted verbatim into wp-vc-visual-conformance.spec.ts
 * and wp-vc2-visual-conformance.spec.ts — WP-30 consolidated both onto this
 * one copy rather than adding a third).
 */
export async function addRecipe(page: Page, name: string, cookMinutes: number): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipes", exact: true }).click();
  await page.getByRole("link", { name: /Add recipe|New recipe/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Cook time (min)" }).fill(String(cookMinutes));
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
}

export interface RichRecipeStep {
  readonly instruction: string;
  readonly durationMinutes?: number;
  /** Markdown text behind the per-step disclosure (RecipeEditor.tsx's "Step N detail (markdown, optional)" textarea). */
  readonly detail?: string;
  readonly photo?: boolean;
}

export interface RichRecipeOptions {
  readonly mealTags?: readonly ("Breakfast" | "Lunch" | "Dinner" | "Snack")[];
  readonly cookMinutes?: number;
  readonly photo?: boolean;
  readonly steps?: readonly RichRecipeStep[];
  readonly staple?: boolean;
  /** One ingredient line per entry — enough for the journey's Plan/pantry-deduction scenario, matching `e2e/wp-22-weekly-planning.spec.ts`'s own (file-local) `addDinnerRecipe` helper. */
  readonly ingredients?: readonly { readonly name: string; readonly amount: string }[];
}

/**
 * Creates a cooked recipe exercising the rich-content fields `addRecipe`
 * above deliberately skips: a recipe photo, and per-step instruction +
 * duration + markdown detail (behind its own disclosure) + per-step photo.
 * Kept as its own helper rather than widening `addRecipe`'s signature — that
 * one is shared by several pre-existing specs at its current 2-arg shape,
 * and none of them need any of this.
 *
 * Step photo inputs are hidden `<input type="file">`s positioned by DOM
 * order (`PhotoField.tsx`) — index 0 is always the recipe's own photo (if
 * `options.photo`), and each subsequent step's photo input follows in step
 * order, exactly the convention `e2e/wp-photo-ui.spec.ts` already relies on.
 */
export async function addRichCookedRecipe(page: Page, name: string, options: RichRecipeOptions = {}): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipes", exact: true }).click();
  await page.getByRole("link", { name: /Add recipe|New recipe/ }).click();
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();

  await page.getByRole("textbox", { name: "Name" }).fill(name);

  // One hidden `<input type="file">` per PhotoField, ALWAYS present in the
  // DOM in card order regardless of whether that card ends up with a photo
  // (PhotoField.tsx renders the input unconditionally; only its visible
  // Add/Replace affordance depends on `hasPhoto`) — index 0 is the recipe's
  // own photo, index `1 + i` is step `i`'s. A running "next unfilled index"
  // counter would drift the moment an EARLIER step has no photo but a LATER
  // one does (it would fill the earlier step's still-empty slot instead),
  // so every photo is addressed by its fixed position, not by a counter.
  const fileInputs = page.locator('input[type="file"]');
  const recipePhotoIndex = 0;
  const stepPhotoIndex = (stepIndex: number): number => 1 + stepIndex;
  if (options.photo) {
    await fileInputs.nth(recipePhotoIndex).setInputFiles(TINY_PHOTO_PATH);
  }

  for (const tag of options.mealTags ?? ["Dinner"]) {
    await page.getByRole("group", { name: "Meal tags" }).getByRole("button", { name: tag }).click();
  }

  if (options.staple) {
    await page.getByRole("radiogroup", { name: "Household flag" }).getByRole("radio", { name: "Staple" }).click();
  }

  for (const ingredient of options.ingredients ?? []) {
    await page.getByRole("button", { name: "Add ingredient line" }).click();
    await page.getByRole("button", { name: /^Ingredient/i }).click();
    await page.getByRole("option", { name: ingredient.name, exact: true }).click();
    await page.getByRole("textbox", { name: /amount/i }).fill(ingredient.amount);
  }

  await page.getByRole("textbox", { name: "Cook time (min)" }).fill(String(options.cookMinutes ?? 20));

  const steps = options.steps ?? [];
  for (let i = 0; i < steps.length; i += 1) {
    if (i > 0) {
      await page.getByRole("button", { name: "Add step" }).click();
    }
    const step = steps[i]!;
    const instructionFields = page.getByRole("textbox", { name: "Instruction" });
    await instructionFields.nth(i).fill(step.instruction);
    if (step.durationMinutes !== undefined) {
      await page.getByRole("textbox", { name: "Duration (min)" }).nth(i).fill(String(step.durationMinutes));
    }
    if (step.detail) {
      await page.getByRole("textbox", { name: `Step ${i + 1} detail (markdown, optional)` }).fill(step.detail);
    }
    if (step.photo) {
      await fileInputs.nth(stepPhotoIndex(i)).setInputFiles(TINY_PHOTO_PATH);
    }
  }

  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
}
