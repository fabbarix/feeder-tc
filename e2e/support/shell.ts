import { expect, type Page } from "@playwright/test";

/**
 * WP-15b / UI_DESIGN.md §12: AppShell gates every route behind
 * signed-out → no-workbook → ready. Real auth (WP-10's src/sheets/auth.ts)
 * and the real workbook registry aren't wired into AppShell yet — that's
 * WP-20's job. Until then, App.tsx's `ShellContainer` bridges with local,
 * session-scoped demo state (sessionStorage, not localStorage — cleared
 * when the browser/context closes) purely so the shell stays exercisable
 * end-to-end: no Google call, mocked or otherwise, is involved in this
 * flow. Call this once per test before navigating to feature routes; the
 * state persists across `page.goto()` calls within the same test/context
 * (sessionStorage is per-origin, not per-navigation) but never leaks into a
 * different test, since Playwright gives each test its own browser context.
 */
export async function enterReadyShell(page: Page): Promise<void> {
  await page.goto("");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  const createButton = page.getByRole("button", { name: "Create new meal planner" });
  await expect(createButton).toBeVisible();
  await createButton.click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}
