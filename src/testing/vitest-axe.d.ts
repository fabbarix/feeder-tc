// Type-only augmentation for the `toHaveNoViolations` matcher registered at
// runtime by `./vitest.setup.ts`. Declared locally (not imported from
// `vitest-axe/matchers`) because that package's own typings mark the export
// `export type *`, which — combined with `verbatimModuleSyntax` — makes it
// impossible to use as a value; see the comment in `vitest.setup.ts`. Same
// augmentation pattern as @testing-library/jest-dom/types/vitest.d.ts.
import "vitest";

interface AxeMatcherResult {
  pass: boolean;
  message(): string;
}

interface AxeMatchers {
  toHaveNoViolations(): AxeMatcherResult;
}

/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars */
declare module "vitest" {
  interface Assertion<T = unknown> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
