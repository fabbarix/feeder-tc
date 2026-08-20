import type { HttpHandler } from "msw";

/**
 * Shared msw request handlers, used by both Vitest (msw/node, via
 * src/mocks/server.ts) and Playwright E2E (msw/browser, via
 * src/mocks/browser.ts). CI must never call real Google APIs — every WP that
 * talks to the Sheets/Drive/Picker REST surface adds its handlers here (or in
 * per-feature handler modules composed into this array) instead of hitting
 * the network in tests.
 *
 * WP-01 ships this empty: there is no transport yet to mock. WP-10/WP-11 add
 * Sheets/Drive handlers.
 */
export const handlers: HttpHandler[] = [];
