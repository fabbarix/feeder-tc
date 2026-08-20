// Component-test setup (WP-15). Separate from src/mocks/vitest.setup.ts,
// which owns the msw/node lifecycle — this file only extends Vitest's
// `expect` with matchers used by component tests:
//
// - @testing-library/jest-dom: `toBeVisible`, `toHaveAccessibleName`, etc.
// - `toHaveNoViolations`: a11y assertions on rendered kit components ("axe
//   checks pass on shell and kit stories" — WP-15 success criteria). See
//   TESTING.md "Accessibility checks" for how a later WP adds one.
import "@testing-library/jest-dom/vitest";
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import type { AxeResults, Result as AxeViolation } from "axe-core";

// The matcher is implemented locally rather than imported from vitest-axe:
// that package's own "vitest-axe/extend-expect" entry point ships an empty
// compiled file in the installed version (0.1.0 — a publish bug, dist/
// extend-expect.js is 0 bytes) and its "vitest-axe/matchers" typings are
// declared `export type *`, so even a direct value import of the real
// function is rejected under `verbatimModuleSyntax`. `vitest-axe` is still
// used for its `axe()` runner (see e.g. QuantityInput.test.tsx), which does
// work correctly — only the matcher half is broken.
function describeViolation(violation: AxeViolation): string {
  const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
  return `- [${violation.impact ?? "unknown"}] ${violation.id}: ${violation.help} (${targets})\n  ${violation.helpUrl}`;
}

expect.extend({
  toHaveNoViolations(results: AxeResults) {
    const violations = results.violations;
    return {
      pass: violations.length === 0,
      message: () =>
        violations.length === 0
          ? "expected axe results to contain at least one violation"
          : `Expected no accessibility violations, found ${violations.length}:\n${violations
              .map(describeViolation)
              .join("\n")}`,
    };
  },
});

// `globals: false` (vitest.config.ts) means RTL's auto-cleanup — which
// detects Jest-style test globals — never registers, so every component
// test in the suite must clean up explicitly or DOM trees pile up across
// tests within a file (the symptom is "Found multiple elements" errors on
// what looks like a single render). One afterEach here covers every
// `*.test.tsx` in the suite.
afterEach(() => {
  cleanup();
});
