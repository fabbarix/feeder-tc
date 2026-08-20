import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.ts on purpose: keeps `vite build`'s config free of
// test-only wiring, and lets this file own the msw/node setup and the
// vitest-cucumber feature-file include pattern without affecting the app bundle.
export default defineConfig({
  base: "/feeder-tc/",
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/mocks/vitest.setup.ts"],
    // Unit/component tests are co-located as `*.test.ts(x)` next to the code
    // they cover (see TESTING.md). Gherkin step definitions live under
    // features/ as `<feature-name>.steps.ts`. Playwright specs under e2e/
    // are intentionally NOT matched here — they run under @playwright/test.
    include: ["src/**/*.test.{ts,tsx}", "features/**/*.steps.ts"],
  },
});
