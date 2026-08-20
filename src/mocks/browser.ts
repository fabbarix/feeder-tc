import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

/**
 * msw browser worker, started from src/main.tsx when
 * `import.meta.env.VITE_ENABLE_MOCKS === "true"`. Playwright's webServer
 * launches the dev server with that flag set (see playwright.config.ts) so
 * E2E runs never hit real Google APIs. Not started in production builds.
 */
export const worker = setupWorker(...handlers);
