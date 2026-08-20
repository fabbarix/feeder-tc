import { defineConfig, devices } from "@playwright/test";

// The dev server (not `vite preview`) is used for speed: it applies the same
// `base` config as production, so base-path + routing behaviour is exercised
// without a build step in the loop. Production build correctness is covered
// separately by `npm run build` in CI.
//
// VITE_ENABLE_MOCKS=true starts the msw browser worker (src/mocks/browser.ts)
// so E2E never calls a real Google API — see TESTING.md.
//
// Deliberately NOT 5173. That port is reserved for `npm run dev`, which is the
// server the product owner signs into for the live Google verification (the
// OAuth client's registered JS origin is http://localhost:5173 — HANDOVER.md
// §7). E2E never talks to Google (msw mocks everything), so it does not need
// that origin, and squatting on it would collide with a running dev server —
// or with an unrelated project's, which is exactly how a green E2E run can end
// up testing someone else's app. Override with E2E_PORT if 5273 is also taken.
const PORT = Number(process.env.E2E_PORT) || 5273;
// Mirrors vite.config.ts's `base` ("/" since the custom-domain cutover). Keep
// the trailing slash: specs pass RELATIVE paths to goto() so they resolve
// against this, and a missing trailing slash would silently drop the last
// segment if a base path is ever reintroduced.
const BASE_URL = `http://localhost:${PORT}/`;

// WP-24: the offline-precache spec (e2e/wp-24-sw-offline.spec.ts) needs a
// *real production build* served statically — `npm run dev`'s server has no
// service worker at all (vite-plugin-pwa's generateSW strategy only runs on
// `vite build`), so it cannot prove the app shell survives going offline.
// That spec gets its own webServer (build + `vite preview`) and its own
// project, on PORT+1 so it never collides with the dev-server project above.
// Every other spec keeps using the fast dev-server project unchanged.
const PWA_PORT = PORT + 1;
const PWA_BASE_URL = `http://localhost:${PWA_PORT}/`;
const PWA_SPEC = /wp-24-sw-offline\.spec\.ts$/;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // exactOptionalPropertyTypes rejects `workers: undefined`, so omit the key
  // entirely for local runs instead (Playwright then picks its own default).
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: PWA_SPEC,
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: PWA_SPEC,
    },
    {
      name: "pwa",
      use: { ...devices["Desktop Chrome"], baseURL: PWA_BASE_URL },
      testMatch: PWA_SPEC,
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${PORT} --strictPort`,
      url: BASE_URL,
      // Always start our own server, never adopt one already on the port. With
      // reuse enabled, a foreign Vite server answers the health check (its SPA
      // fallback 200s on any path) and the whole suite silently runs against the
      // wrong app. --strictPort then turns a collision into a loud startup
      // failure instead of a mysterious "element not found".
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_ENABLE_MOCKS: "true",
        // WP-20 wires the real createGoogleAuth/Picker into AppShell. Those
        // read env lazily (src/env.ts) only when a user clicks "Sign in" —
        // never at import time — but by then something must be there.
        // Neither var is set in CI (only deploy.yml's build job gets the real
        // ones), and requiring a local .env.local just to run E2E would be
        // hostile. The values are never checked against a real Google
        // backend: msw fakes every request that would carry them, so any
        // non-empty string works.
        VITE_GOOGLE_CLIENT_ID: "e2e-fake-client-id.apps.googleusercontent.com",
        VITE_GOOGLE_API_KEY: "e2e-fake-api-key",
      },
    },
    {
      // Deliberately built WITHOUT VITE_ENABLE_MOCKS: msw's own browser
      // worker (public/mockServiceWorker.js) registers at the same scope
      // ("/") that vite-plugin-pwa's generated sw.js registers at, and two
      // service worker scripts cannot both hold that one scope — the second
      // registration replaces the first. Every route this spec exercises is
      // still a static stub with no network calls (see src/routes/*.tsx), so
      // nothing here needs mocking; omitting it sidesteps the collision and
      // is closer to the real GitHub Pages build anyway. Serves the real
      // dist/ output — sw.js, the precache manifest, 404.html — exactly as
      // Pages would. reuseExistingServer:false + --strictPort for the same
      // reason as the dev server above.
      command: `npm run build && npm run preview -- --port ${PWA_PORT} --strictPort`,
      url: PWA_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        // Required even though this project mocks nothing. WP-20's shell
        // constructs the Google wiring at first render, and src/env.ts throws
        // on the first READ of a missing VITE_GOOGLE_* value — so a build
        // without them white-screens instead of rendering the sign-in screen,
        // and every assertion here fails looking for a heading that never
        // mounted. Production always has them (deploy.yml passes the repo
        // vars), so supplying fakes here mirrors the real build rather than
        // papering over anything. See STATUS.md "Known debt" for the
        // underlying fragility, which is a WP-31 polish item.
        VITE_GOOGLE_CLIENT_ID: "e2e-fake-client-id.apps.googleusercontent.com",
        VITE_GOOGLE_API_KEY: "e2e-fake-api-key",
      },
    },
  ],
});
