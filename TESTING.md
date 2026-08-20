# Testing conventions

Short and literal — later work packages follow this file, not tribal knowledge.

## File layout

| Kind                   | Location                                | Naming                               |
| ---------------------- | --------------------------------------- | ------------------------------------ |
| Unit / component tests | co-located next to the code they cover  | `<name>.test.ts` / `<name>.test.tsx` |
| BDD feature files      | `features/`                             | `<wp-id>-<name>.feature`             |
| BDD step definitions   | `features/`, next to their feature file | `<wp-id>-<name>.steps.ts`            |
| E2E specs (Playwright) | `e2e/`                                  | `<wp-id>-<name>.spec.ts`             |
| msw handlers           | `src/mocks/`                            | see below                            |

Unit tests are **co-located**, not under a parallel `tests/` tree — keeps a
pure domain module and its test next to each other, and deleting/moving a
module takes its test with it.

Vitest only picks up `src/**/*.test.{ts,tsx}` and `features/**/*.steps.ts`
(see `vitest.config.ts`). `e2e/**` is deliberately excluded from Vitest's
`include` — those files use `@playwright/test`'s `test`/`expect`, not
Vitest's, and are run only via `npm run test:e2e`.

## Writing a `.feature` + steps (Vitest, engine/unit level)

1. Add `features/<wp-id>-<name>.feature` in Gherkin. One `Feature`, one or
   more `Scenario`s — copy scenario text verbatim from
   `IMPLEMENTATION_PLAN.md` where the WP lists mandatory BDD scenarios.
2. Add `features/<wp-id>-<name>.steps.ts` next to it:

   ```ts
   import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
   import { expect } from "vitest";

   const feature = await loadFeature("./<wp-id>-<name>.feature");

   describeFeature(feature, ({ Scenario }) => {
     Scenario("<scenario title, verbatim>", ({ Given, When, Then, And }) => {
       Given("...", () => { /* arrange */ });
       When("...", () => { /* act */ });
       Then("...", () => { expect(...).toBe(...); });
     });
   });
   ```

3. `loadFeature`'s path is resolved relative to the calling file, so a step
   file next to its feature file just uses `./<name>.feature`.
4. Run `npm test` (or `npm run test:watch` while iterating).

See `features/wp-01-harness.feature` / `features/wp-01-harness.steps.ts` for
a trivial worked example.

## msw handlers

`src/mocks/handlers.ts` exports the single `handlers` array shared by both
runtimes:

- `src/mocks/server.ts` — `msw/node`, wired into Vitest via
  `src/mocks/vitest.setup.ts` (`beforeAll`/`afterEach`/`afterAll` listen /
  resetHandlers / close). Any unhandled request **throws** — add a handler
  instead of letting a test hit the network.
- `src/mocks/browser.ts` — `msw/browser`, started from `src/main.tsx` only
  when `import.meta.env.VITE_ENABLE_MOCKS === "true"`. Playwright's
  `webServer` sets that flag (see `playwright.config.ts`), so E2E runs never
  call a real Google API.

When a WP needs new mocked endpoints (Sheets/Drive/Picker REST calls), add
handlers to `src/mocks/handlers.ts` (or a per-feature module composed into
that array) — do not create a second server/worker instance.

**CI must never call real Google APIs.** If a test needs to exercise a code
path against Sheets/Drive/Picker, mock it here.

## Adding an `@e2e` scenario (Playwright)

1. Add `e2e/<wp-id>-<name>.spec.ts` using `@playwright/test`'s `test`/
   `expect`. Copy the `@e2e`-tagged Gherkin scenario text from
   `IMPLEMENTATION_PLAN.md` into the spec's description/comments so intent
   stays traceable back to the plan.
2. Pass a **relative** path to `page.goto()` — `"pantry"`, or `""` for the
   index. `baseURL` mirrors Vite's `base` (`http://localhost:5273/`), and an
   argument with a **leading slash resolves against the origin**, discarding
   any base path. That is harmless while `base` is `"/"`, but it silently
   tested the wrong URL when the app was served from `/feeder-tc/` — keep
   paths relative so a future base change cannot resurrect that bug. Routes
   are real History API paths (`createBrowserRouter`), so assert on the
   pathname — `/\/pantry$/` — never on a `#` fragment.
3. Any network calls (Google auth, Sheets) must be served by the msw browser
   worker — see above. Do not add real network calls to an E2E spec.
4. Run `npm run test:e2e` (headless Chromium + a `mobile-chrome` project on
   a Pixel 7 viewport, both defined in `playwright.config.ts`).

See `e2e/wp-01-harness.spec.ts` for a trivial worked example.

## Ports

| Port   | Owner              | Why                                                                  |
| ------ | ------------------ | -------------------------------------------------------------------- |
| `5173` | `npm run dev` only | The OAuth client's registered JS origin (HANDOVER §7). Keep it free. |
| `5273` | `npm run test:e2e` | Override with `E2E_PORT=<n>` if taken.                               |

E2E deliberately does not use 5173: that port belongs to the dev server the
product owner signs into for the live Google check, and several agents may be
running on one machine. Playwright always starts its **own** server
(`reuseExistingServer: false`, `--strictPort`) — if you see a startup failure
saying the port is in use, that is working as intended. Never "fix" it by
re-enabling server reuse: a foreign Vite server answers the health check with
its SPA fallback, and the entire suite then passes or fails against somebody
else's app.

## Definition of done (every WP)

```
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

All five green, plus any mandatory BDD scenarios the WP lists in
`IMPLEMENTATION_PLAN.md` implemented and passing, and no `HANDOVER.md` §4
invariant violated.
