// @ts-check
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import confirmDialogDestructive from "./eslint-rules/confirm-dialog-destructive.js";
import routeDataHookShape from "./eslint-rules/route-data-hook-shape.js";

// Local, in-repo rules (eslint-rules/**) — same reasoning as every other
// `no-restricted-*` entry below: pin the CONVENTION structurally so CI
// catches the next instance, not just the ones this audit happened to find.
// See each rule file's own header comment for which pattern-audit finding
// it pins.
const local = { rules: { "confirm-dialog-destructive": confirmDialogDestructive, "route-data-hook-shape": routeDataHookShape } };

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
    // WP-tokens enforcement #6 (token-layer proposal `#enforce`): no raw
    // pixel dimensions in a src/ui/** inline `style={{...}}` prop. Same
    // enforcement shape as the `no-restricted-imports` boundary rules above
    // — this is what would have caught a component-level hardcode (the
    // audit's 184px `.meter` width) at the authoring point, in the kit,
    // instead of after a reviewer measured the rendered page. Scoped to
    // src/ui/** only (the kit), matching the proposal's own scope — feature
    // routes under src/routes/** style almost entirely through
    // *.module.css, and this isn't a general ban on inline styles (dynamic
    // values like a computed `width: pct + "%"` or a `height` passed through
    // as a prop are unaffected; only a literal number token is banned).
    //
    // The pattern-audit #2/#5 selectors below (reload-as-retry, raw
    // toLocale*String) also apply here — flat config REPLACES, not merges,
    // a `rules` key across matching objects, so every `no-restricted-syntax`
    // selector that should fire inside src/ui/** has to live in this same
    // array rather than a second object also matching src/ui/**.
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='style'] ObjectExpression Property > Literal[raw=/^-?\\d/]",
          message:
            "No raw pixel dimension in an inline style — add/use a design token (var(--space-*), var(--radius-*), var(--fs-*)) or a CSS module class instead (token-layer proposal, enforcement #6).",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='reload'][callee.object.type='MemberExpression'][callee.object.property.name='location']",
          message:
            "window.location.reload() must not be used as an ErrorState retry (pattern-audit #2) — it throws away scroll position, focus and any typed search. Sync state arrives as props from the container (UI_DESIGN.md §7/§8) — a retry belongs to the route hook, not the kit.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^toLocale(Date|Time)?String$/]",
          message:
            "No direct toLocaleDateString/toLocaleTimeString/toLocaleString for a displayed date (pattern-audit #5) — add a formatter to src/routes/date-format.ts and use that instead, so every date/month display shares one locale-/timezone-safe implementation.",
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
  {
    // Pattern audit #1: "a destructive dialog that is not marked
    // destructive, four lines from one that is" — see
    // eslint-rules/confirm-dialog-destructive.js's own header comment.
    files: ["src/**/*.tsx"],
    plugins: { local },
    rules: {
      "local/confirm-dialog-destructive": "error",
    },
  },
  {
    // Pattern audit #2 half A + #5, in ONE config object: flat config
    // merges `rules` per-key across matching objects, so a SECOND object
    // also setting `no-restricted-syntax` for overlapping files would
    // silently REPLACE this one instead of adding to it — both selectors
    // have to live in the same array.
    //
    // #2 half A — "retry means two different things on sibling tabs": a
    // route's ErrorState must always offer a soft re-fetch, never a hard
    // reload that throws away scroll/focus/typed search. The one
    // deliberate exception is RouteError.tsx's own error-boundary retry
    // (an error boundary has no state left to preserve and genuinely
    // cannot soft-retry — its own header comment explains why), silenced
    // there with an inline eslint-disable rather than a file `ignores`
    // here, precisely so it can't silently swallow this rule's OTHER
    // selector too. pwa/update.ts's reload is a different feature (the PWA
    // "new version" prompt, user-initiated) and needs no exception at all.
    //
    // #5 — "a chart axis bypasses the shared date formatter":
    // `date-format.ts` exists precisely because
    // `toLocaleDateString`/`toLocaleString`/`toLocaleTimeString` are
    // locale- and timezone-sensitive, and every display date in the app was
    // deliberately moved onto it (ProductPriceChart.tsx's monthLabel was
    // the one holdout). `date-format.ts` itself does its own manual
    // day/month parsing rather than calling these, so this is a flat ban.
    // Excludes src/ui/** — those same two selectors already live in the
    // src/ui/**-scoped object above, alongside its own raw-pixel selector,
    // for the "same rule key, one array" reason explained there too.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='reload'][callee.object.type='MemberExpression'][callee.object.property.name='location']",
          message:
            "window.location.reload() must not be used as an ErrorState retry outside RouteError.tsx (pattern-audit #2) — it throws away scroll position, focus and any typed search. Give the route a useXxxData-shaped hook exposing retry instead (see useRecipesData.ts/useIngredientsData.ts/useHomeData.ts). A genuine error-boundary exception needs an inline eslint-disable, not a file-level ignore.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^toLocale(Date|Time)?String$/]",
          message:
            "No direct toLocaleDateString/toLocaleTimeString/toLocaleString for a displayed date (pattern-audit #5) — add a formatter to src/routes/date-format.ts and use that instead, so every date/month display shares one locale-/timezone-safe implementation.",
        },
      ],
    },
  },
  {
    // Pattern audit #2, half B: the hook-shape half of the same fix — see
    // eslint-rules/route-data-hook-shape.js's own header comment for why
    // this is scoped by FILE naming convention rather than by the type's
    // own name.
    files: ["src/routes/**/use*.{ts,tsx}"],
    plugins: { local },
    rules: {
      "local/route-data-hook-shape": "error",
    },
  },
);
