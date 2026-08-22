import { expect, type Locator, type Page } from "@playwright/test";

export async function goToPlan(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
}

export async function generateWeek(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Generate week" }).click();
  await expect(page.getByRole("button", { name: /Pick a meal/ })).toHaveCount(0, { timeout: 10_000 });
}

/**
 * The visible day container (desktop 7-column grid or mobile stacked day
 * card — `PlanSlotRow.tsx`'s own comment: "shared markup" between both,
 * `Plan.tsx` renders both DOM subtrees and CSS hides one per viewport,
 * `getByRole` only ever matches the one actually in the accessibility
 * tree), found via its `<h2>` day-label heading — same technique
 * `e2e/wp-22-weekly-planning.spec.ts` already uses.
 */
export function dayCard(page: Page, dayShort: string): Locator {
  const heading = page.getByRole("heading", { name: new RegExp(`^${dayShort} \\d+`) });
  return heading.locator("xpath=..");
}

/** Fills an EMPTY slot by clicking its "Pick a meal for {tag}" button, then the named recipe in the picker. */
export async function pickMealForEmptySlot(page: Page, day: Locator, mealTag: string, recipeName: string): Promise<void> {
  await day.getByRole("button", { name: `Pick a meal for ${mealTag}` }).click();
  await page.getByRole("button", { name: recipeName, exact: true }).click();
}

/**
 * Clears an already-filled, still-`planned` (future) slot: clicking the
 * recipe's own name re-opens `RecipePickerDialog`, which offers "Clear this
 * slot" whenever the slot wasn't empty (`Plan.tsx`'s `picker.isEmpty`
 * check) — this is the ONLY "remove from plan" affordance the app actually
 * ships (see the journey/reach-plan specs' own doc comments for what the
 * design mock proposes instead, and why it doesn't exist here). No confirm
 * step exists — `usePlanWeek.ts`'s `clearSlot` fires immediately.
 */
export async function clearFutureSlot(page: Page, day: Locator, recipeName: string): Promise<void> {
  await day.getByRole("button", { name: recipeName, exact: true }).click();
  await page.getByRole("button", { name: "Clear this slot" }).click();
  await expect(page.getByRole("button", { name: "Clear this slot" })).toHaveCount(0);
}

export async function markSlotCooked(page: Page, day: Locator, recipeName: string): Promise<void> {
  await day.getByRole("button", { name: "Cook" }).click();
  await expect(page.getByRole("heading", { name: `Mark "${recipeName}" cooked` })).toBeVisible();
  await page.getByRole("button", { name: "Mark cooked" }).click();
  await expect(page.getByRole("heading", { name: `Mark "${recipeName}" cooked` })).toHaveCount(0);
}

const DAY_SHORT: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Today's `Mon`/`Tue`/... abbreviation, matching `DaySlotEditor.tsx`'s day labels and the `<h2>` day headings Plan.tsx renders for each day — used to find "today"'s card without hard-coding a weekday, since which day is "today" depends on when the suite runs. */
export function todayShortLabel(): string {
  return DAY_SHORT[new Date().getDay()]!;
}

/** The day card whose recipe-slot badge reads "· tonight" (`PlanSlotRow.tsx`'s `isToday` marker, `plan-derive.ts`'s `view.isToday`) — the app's only "today" highlight; there is no day-level CSS treatment (confirmed: no `istoday`/`today` class wired in `plan.module.css`, unlike `design/mock-responsive.html`'s proposed accent tint). */
export function todayCard(page: Page): Locator {
  return dayCard(page, todayShortLabel());
}

export async function pinSlot(day: Locator): Promise<void> {
  await day.getByRole("button", { name: "Pin" }).click();
  await expect(day.getByRole("button", { name: "Unpin" })).toBeVisible();
}

export async function rerollSlot(day: Locator): Promise<void> {
  await day.getByRole("button", { name: "Reroll" }).click();
}

/** `Fewer/More servings for {recipe}` icon buttons (`PlanSlotRow.tsx`) — absent for an indivisible recipe (shows a static "→ N leftover" badge instead), present at every tier with no viewport gating despite `design/mock-responsive.html`'s "phone-only" note (see the journey/reach specs' own doc comments). */
export async function bumpServings(day: Locator, recipeName: string, times = 1): Promise<void> {
  const more = day.getByRole("button", { name: `More servings for ${recipeName}` });
  for (let i = 0; i < times; i += 1) {
    await more.click();
  }
}
