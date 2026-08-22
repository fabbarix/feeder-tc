import type { Page } from "@playwright/test";

/**
 * Clears every currently-shown toast (`src/ui/components/Toast`). Several
 * journey specs fire a handful of toasts back-to-back (creating recipes,
 * ingredients, pantry lots one after another) — on a narrow phone viewport
 * the toast viewport's fixed bottom band can sit directly over the next
 * form's submit button, so an un-dismissed toast intermittently intercepts
 * the click (Playwright's actionability check reports it). Same fix
 * `e2e/wp-22-weekly-planning.spec.ts` already applies locally; promoted here
 * so the new cross-tier suite doesn't re-invent it per spec file.
 */
export async function dismissToasts(page: Page): Promise<void> {
  const dismissButtons = page.getByRole("region", { name: "Notifications" }).getByRole("button");
  while ((await dismissButtons.count()) > 0) {
    await dismissButtons.first().click();
  }
}
