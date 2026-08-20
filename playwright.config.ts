import { defineConfig, devices } from "@playwright/test";

// The dev server (not `vite preview`) is used for speed: it applies the same
// `base: "/feeder-tc/"` config as production, so base-path + hash-routing
// behavior is exercised without a build step in the loop. Production build
// correctness is covered separately by `npm run build` in CI.
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
const BASE_URL = `http://localhost:${PORT}/feeder-tc/`;

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
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
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
    },
  },
});
