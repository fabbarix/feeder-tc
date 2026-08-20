// @ts-check
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      "playwright-report",
      "test-results",
      "public/mockServiceWorker.js",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      prettierConfig,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
  },
  {
    // Node-context files: build/test tooling configs and Playwright/Vitest
    // step definitions run under Node, not the browser.
    files: ["*.config.{ts,js}", "e2e/**/*.{ts,tsx}", "features/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // src/domain/units.ts is the single sanctioned entry-time unit-
    // conversion module (M6-A — DESIGN_PRODUCTS.md §3, HANDOVER.md §4
    // invariant 3's amendment). Everything except the module's own test
    // file is forbidden from importing it: no engine (inventory fold,
    // planner, shopping allocator), no codec, no sync layer. Only a future
    // product editor (src/ui, out of scope here) is meant to call it. This
    // makes a violation fail `npm run lint`, not just code review — see
    // units.ts's header comment for the full reasoning.
    files: ["src/domain/**/*.{ts,tsx}", "src/sheets/**/*.{ts,tsx}", "src/sync/**/*.{ts,tsx}"],
    ignores: ["src/domain/units.ts", "src/domain/units.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/units.ts", "**/units", "./units.ts", "./units"],
              message:
                "src/domain/units.ts is the single sanctioned entry-time unit-conversion module (product editor only, DESIGN_PRODUCTS.md §3). No engine, codec, fold, or sheet may import it — see the file's header comment.",
            },
          ],
        },
      ],
    },
  },
);
