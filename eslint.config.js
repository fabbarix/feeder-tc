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
    // The component boundary (UI_DESIGN.md §7) plus the icon vocabulary
    // (§9), for every file under src/ui/** EXCEPT the curated icon barrel
    // itself (which is the one file allowed to import Phosphor directly).
    //
    // Forbidden: WorkbookStore, SnapshotStore, Outbox, SheetsTransport, any
    // engine (computeShoppingList, generateWeek, applyNewEvents), data
    // fetching, localStorage (the theme provider is the one deliberate
    // exception, and it's a global API, not an import — nothing to lint).
    // Allowed from src/domain/: only value types and pure formatters
    // (Quantity, IsoDate, Unit, MealTag, StorageLocation, formatQuantity,
    // makeIsoDate, addDays) — i.e. only types.ts/quantity.ts/dates.ts, not
    // contracts.ts (interfaces like WorkbookStore/Outbox/DataWarning live
    // there) and not any engine module.
    files: ["src/ui/**/*.{ts,tsx}"],
    ignores: ["src/ui/icons.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@phosphor-icons/react",
              message: "Import icons from src/ui/icons.ts, not @phosphor-icons/react directly (UI_DESIGN.md §9).",
            },
          ],
          patterns: [
            {
              group: [
                "**/domain/**",
                "!**/domain/types.ts",
                "!**/domain/types",
                "!**/domain/quantity.ts",
                "!**/domain/quantity",
                "!**/domain/dates.ts",
                "!**/domain/dates",
              ],
              message:
                "src/ui/** may only import src/domain/{types,quantity,dates} — value types and pure formatters only (UI_DESIGN.md §7). No contracts.ts, no engines.",
            },
            {
              group: ["**/sheets/**"],
              message: "src/ui/** must not import the Sheets transport/auth layer (UI_DESIGN.md §7). Data arrives via props.",
            },
            {
              group: ["**/sync/**"],
              message:
                "src/ui/** must not import sync/outbox/snapshot modules (UI_DESIGN.md §7/§8). Sync state arrives as props from the container.",
            },
          ],
        },
      ],
    },
  },
  {
    // Everywhere OUTSIDE the kit: Phosphor must be imported through the
    // curated barrel (UI_DESIGN.md §9), never directly — this is what keeps
    // "swap icon libraries later" a one-file change and stops two mismatched
    // icons for the same concept appearing in different feature packages.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@phosphor-icons/react",
              message: "Import icons from src/ui/icons.ts, not @phosphor-icons/react directly (UI_DESIGN.md §9).",
            },
          ],
        },
      ],
    },
  },
);
