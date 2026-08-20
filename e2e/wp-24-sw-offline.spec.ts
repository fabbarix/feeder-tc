import { expect, test } from "@playwright/test";

// WP-24: proves the service worker's app-shell precache actually works —
// the app shell loads with the network down once the worker is installed.
// Runs only against the "pwa" project (see playwright.config.ts), which
// serves a real `npm run build` output via `vite preview`: the dev server
// Playwright's other projects use has no service worker at all (vite-plugin-
// pwa's generateSW strategy only runs on `vite build`), so this behaviour is
// unverifiable there — see HANDOVER.md §5 on why the emit-spa-fallback
// plugin can't be verified locally either, same root cause.
//
// Every route under test is a static stub with no network calls of its own
// (src/routes/*.tsx) — see playwright.config.ts's "pwa" webServer comment for
// why this build deliberately runs without msw. What's under test is purely
// the SW's own precache + navigateFallback behaviour.

test.describe("service worker app-shell precache", () => {
  test("the app shell loads with the network down once the worker is installed", async ({
    page,
    context,
  }) => {
    // First load: online, so the SW can register and precache the app shell
    // (workbox-precaching fetches every manifest entry during its own
    // 'install' event, independent of whether THIS page later goes offline).
    await page.goto("");
    await expect(page.getByRole("heading", { name: "Feeder" })).toBeVisible();

    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
    const registrationCount = await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.length;
    });
    expect(registrationCount).toBeGreaterThan(0);

    // Now go offline and reload. A working precache serves this from the
    // cache; without one, the browser would show its own offline error page
    // and none of the assertions below would find anything.
    await context.setOffline(true);
    const response = await page.reload();

    // The service worker answers navigations itself, so the offline reload
    // gets a real 200 from the cache (not a network error).
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Feeder" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    await context.setOffline(false);
  });

  // Requirement 3: once installed, the SW must serve navigations for deep
  // links — the mechanism that turns the cold-load 404 (emit-spa-fallback's
  // 404.html, HANDOVER.md §5) into a 200 for returning visitors.
  test("serves a deep link while offline via navigateFallback", async ({ page, context }) => {
    await page.goto("");
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));

    await context.setOffline(true);
    const response = await page.goto("pantry");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Pantry" })).toBeVisible();
    await expect(page).toHaveURL(/\/pantry$/);

    await context.setOffline(false);
  });
});
