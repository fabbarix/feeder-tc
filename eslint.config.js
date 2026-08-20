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
  {
    // src/domain/units.ts is the single sanctioned entry-time unit-conversion
    // module (M6-A — DESIGN_PRODUCTS.md §3, and HANDOVER.md §4 invariant 3's
    // amendment). Everything except the module's own test is forbidden from
    // importing it: no engine (inventory fold, planner, shopping allocator),
    // no codec, no sync layer. Only a product editor under src/ui is meant to
    // call it. This makes a violation fail `npm run lint` rather than relying
    // on code review — see units.ts's header comment for the reasoning.
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
