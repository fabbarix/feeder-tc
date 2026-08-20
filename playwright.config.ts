import { defineConfig, devices } from "@playwright/test";

// The dev server (not `vite preview`) is used for speed: it applies the same
// `base: "/feeder-tc/"` config as production, so base-path + hash-routing
// behavior is exercised without a build step in the loop. Production build
// correctness is covered separately by `npm run build` in CI.
//
// VITE_ENABLE_MOCKS=true starts the msw browser worker (src/mocks/browser.ts)
// so E2E never calls a real Google API — see TESTING.md.
//
// Defaults to 5173 to match the OAuth client's registered JS origin
// (HANDOVER.md §7). Override with E2E_PORT if something else already holds
// 5173 on your machine (e.g. another project's dev server).
const PORT = Number(process.env.E2E_PORT) || 5173;
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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_ENABLE_MOCKS: "true",
    },
  },
});
