import { expect, type Page } from "@playwright/test";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** `DaySlotEditor.tsx` labels a slot chip with `MEAL_TAG_OPTIONS`'s Title Case label (src/routes/recipe-options.ts), not the raw lowercase `MealTag` domain value — this is the accessible-name vocabulary, not the domain one. */
type MealTagLabel = "Breakfast" | "Lunch" | "Dinner" | "Snack";

export async function goToSettings(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/** `Stepper`'s two buttons are always named `` `Fewer — ${label}` ``/`` `More — ${label}` `` (src/routes/Stepper.tsx) — one helper for every Stepper on Settings (household size, repeat window) rather than one per field. */
async function clickStepper(page: Page, label: string, direction: "more" | "fewer", times = 1): Promise<void> {
  const name = `${direction === "more" ? "More" : "Fewer"} — ${label}`;
  for (let i = 0; i < times; i += 1) {
    await page.getByRole("button", { name }).click();
  }
}

export async function setHouseholdSize(page: Page, target: number): Promise<void> {
  // Default household size is 2 (sheets/bootstrap.ts DEFAULT_SETTINGS).
  const current = 2;
  const direction = target >= current ? "more" : "fewer";
  await clickStepper(page, "Size", direction, Math.abs(target - current));
  await expect(page.getByText(`${target} people`)).toBeVisible();
}

export async function setRepeatExclusionWeeks(page: Page, target: number): Promise<void> {
  // Default is 2 weeks (sheets/bootstrap.ts DEFAULT_SETTINGS).
  const current = 2;
  const direction = target >= current ? "more" : "fewer";
  await clickStepper(page, "Don't repeat within", direction, Math.abs(target - current));
}

async function removeSlotChip(page: Page, day: (typeof DAYS)[number], tag: MealTagLabel): Promise<void> {
  const button = page.getByRole("button", { name: `Remove ${tag} on ${day}` });
  if ((await button.count()) === 0) return;
  await button.click();
  await expect(button).toHaveCount(0);
}

/** Trims the default breakfast/lunch/dinner-every-day layout down to dinner-only, for every day — the deterministic setup `journey-household-week.spec.ts`'s "Generate week" step depends on, same technique as `e2e/wp-22-weekly-planning.spec.ts`'s local `makeDinnerOnly`, promoted here for reuse. */
export async function makeDinnerOnly(page: Page): Promise<void> {
  await goToSettings(page);
  for (const day of DAYS) {
    await removeSlotChip(page, day, "Breakfast");
    await removeSlotChip(page, day, "Lunch");
  }
}

/** `ThemeControl`'s three-state `SegmentedControl` (`ThemeControl.tsx`, mounted only on Settings) — "System"/"Light"/"Dark" radios under the "Appearance" `aria-labelledby` group, no viewport gating anywhere in `ThemeControl.module.css`. */
export async function setThemeMode(page: Page, mode: "System" | "Light" | "Dark"): Promise<void> {
  await page.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { name: mode }).click();
  await expect(page.getByRole("radio", { name: mode })).toBeChecked();
}

/** One of the 12 accent-hue swatches (`ThemeControl.tsx`'s `HUES`, 0/30/60.../330 degrees) — each a plain `aria-pressed` toggle button named `Hue {n} degrees`. */
export async function setAccentHue(page: Page, degrees: number): Promise<void> {
  const swatch = page.getByRole("button", { name: `Hue ${degrees} degrees` });
  await swatch.click();
  await expect(swatch).toHaveAttribute("aria-pressed", "true");
}
