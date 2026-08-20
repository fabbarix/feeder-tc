# Handover — Meal Planner

Audience: the **coordinating agent** that will plan, dispatch, and integrate the work
of multiple development agents. Read this file first, then `DESIGN.md` (full design,
authoritative), then `IMPLEMENTATION_PLAN.md` (work breakdown, dependencies, success
criteria, BDD tests).

## 1. Mission

Build a household meal-planning web app with a pantry-aware shopping list:

- Static frontend (Vite + React + TypeScript) served from **GitHub Pages**.
- Backend is a **Google Sheets workbook**, accessed directly from the browser via the
  Sheets REST API. **No server-side code, no Apps Script.**
- Google auth with the non-sensitive **`drive.file`** scope; the app creates the
  workbook; household members share via native Sheets sharing + Google Picker.
- Features: recipes (incl. bought/pre-prepared meals), event-sourced pantry with lot
  tracking / FIFO / shelf life, flexible meal-slot planner with staple/rotation
  voting and a weighted generator, leftovers tracking, shopping list computed as
  needs-minus-viable-stock, in-store check-off that creates pantry lots, offline PWA
  with a write outbox.

## 2. Current state

- The repository contains only design documents: `DESIGN.md`, `HANDOVER.md` (this
  file), `IMPLEMENTATION_PLAN.md`. **No code exists yet.** Git may need `git init`.
- All product decisions below were made explicitly with the product owner in a
  design interview on 2026-08-20. Do **not** re-litigate them; if a genuine
  contradiction or blocker is found, surface it to the owner instead of silently
  choosing.

## 3. Decision register (condensed — details in DESIGN.md)

| Area | Decision |
|---|---|
| Data access | Browser → Google Sheets REST API directly; no Apps Script |
| OAuth | `drive.file` scope; app creates the workbook; Picker for shared/opened workbooks |
| Concurrency | Append-mostly + last-write-wins; no locking, no version columns |
| Inventory | Event-sourced (append-only `InventoryEvents`); everything else plain rows |
| Client cache | localStorage snapshot + row-index cursor + `generation` number in `Meta` |
| Units | Exactly one canonical unit per ingredient; no conversions; fractions allowed |
| Lots | Per-purchase lots, FIFO consumption, per-lot expiry; freezer suspends expiry |
| Shelf life | Catalog defaults (`shelf_life_days`, `opened_shelf_life_days`, default location); per-lot manual override; ~100-item seeded catalog |
| Bought meals | Recipes with `kind=bought`: prep 0, real cook time, optional heating steps, single product ingredient line |
| Servings | Household size in settings; auto-scaling with per-slot override |
| Leftovers | Full tracking: surplus servings → leftover lot (portion unit), plannable into future slots, no shopping needs |
| Slots | All meals, flexible per-day slot layout (configurable in Settings); recipes carry meal-type tags |
| Voting | Household-level 3-state flag per recipe: staple / in-rotation / retired |
| Generator | Staples first (round-robin if oversubscribed), then weighted random: strong boost for expiring-lot usage, mild boost for ingredient overlap within week, exclude recipes cooked in last N weeks (default 3) |
| Cooking | "Mark cooked" → confirm screen → FIFO usage events; surplus → leftover lot |
| Shopping math | Needs minus viable stock: a lot counts only if expiry ≥ planned cook date; FIFO allocation; week or multi-week ranges |
| In-store | Check-off immediately creates the purchase lot (pre-filled qty, editable for package sizes) |
| Offline | Installable PWA; app-shell caching; append-only write outbox flushed on reconnect |
| Stack | Vite + React + TypeScript, path routing (`404.html` SPA fallback), GitHub Actions → Pages |
| Recipe storage | Join-row sheets (`RecipeIngredients`, `RecipeSteps`), not JSON blobs, not wide columns |
| Delivery | Foundations-up milestones M1–M5 (recipe box → pantry → planner → shopping → offline) |

## 4. Invariants — must never be violated by any agent

1. **`InventoryEvents` rows are immutable.** Never edit or delete an event row.
   Corrections are new `adjust` events. Compaction is a deliberate operation that
   bumps `Meta.generation`.
2. **Cursor safety.** Any client whose cached `generation` mismatches `Meta` must
   discard its snapshot and re-read fully.
3. **One canonical unit per ingredient.** No conversion logic anywhere. Reject
   mixed-unit writes at the codec layer.
4. **FIFO everywhere quantities are consumed** (usage, shopping allocation).
5. **Sheets is the source of truth; localStorage is a cache.** Any local state must
   be reconstructible from the workbook alone.
6. **The workbook stays human-readable.** No JSON blobs in cells; one row = one
   fact; header row on every sheet.
7. **No server-side components.** If a feature seems to need one, escalate.
8. **Sensitive scopes are forbidden.** Only `drive.file` (plus Picker's own scope).
9. **Offline writes are events appended via the outbox** — never queued in-place
   edits for inventory.

## 5. Environment & conventions for all dev agents

- **Dependencies**: always add/remove/update via the npm CLI (`npm install`,
  `npm uninstall`, …). Never hand-edit `package.json` dependency entries.
- TypeScript `strict: true`. Domain engines are **pure modules** (no I/O, no React,
  no globals) so they are unit-testable and parallel-safe.
- Tests: Vitest for unit/BDD (Gherkin `.feature` files under `features/` executed
  with `@amiceli/vitest-cucumber`); Playwright for E2E with a mocked Sheets API
  (msw). Every work package lists mandatory scenarios in `IMPLEMENTATION_PLAN.md`.
- Definition of done for every work package: `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build` all green; mandatory BDD scenarios implemented and
  passing; no invariant violated.
- Google API access in tests is always mocked; no real Google calls in CI.
- **Path routing** (`/recipes/12`), `createBrowserRouter`. **Superseded the
  original hash-routing decision on 2026-08-20 at the product owner's request.**
  GitHub Pages still cannot rewrite paths; the app works around it by emitting
  `404.html` as an exact copy of `index.html` (see the `emit-spa-fallback`
  plugin in `vite.config.ts`), which Pages serves for any unmatched path. Do
  **not** reintroduce `createHashRouter` or assert on `#` fragments.
  - The router's `basename` comes from `import.meta.env.BASE_URL`, so the same
    build works under a base path or at a domain root.
  - A cold deep link is served with HTTP status 404 while rendering correctly.
    Accepted trade-off: the app is private and auth-gated, so crawler/SEO
    behaviour is irrelevant, and WP-24's service worker serves navigations
    from the precache with a 200 once installed.
  - The 404.html fallback **cannot be verified locally** — `vite dev` and
    `vite preview` both have their own SPA fallback and will mask a broken
    one. Verify against the deployed site.

## 6. Coordination protocol

- **Contracts first.** WP-02 (interface contracts) gates all parallel work. Parallel
  agents code against the contract types and mocked interfaces, not each other's
  implementations.
- **Isolation.** Dispatch parallel packages in separate git worktrees/branches; one
  PR per work package; the coordinator integrates in dependency order and runs the
  full suite after each merge.
- **Integration order** when merges queue up: transport/auth (WP-10/11) →
  engines (WP-12/13/14) → sync (WP-17) → UI shell (WP-15) → features (WP-2x).
- **Conflict rule**: contracts (`src/domain/types.ts` etc.) may only be changed by a
  dedicated contract-change task approved by the coordinator, since every parallel
  agent depends on them.
- **Escalation**: anything requiring product-owner input (Google Cloud console
  actions, scope changes, design contradictions) is blocked-on-user; park the
  package and continue elsewhere.

## 7. Google Cloud / GitHub provisioning — ✅ COMPLETE (2026-08-20)

Provisioning is done; nothing in this section needs re-doing. Current state:

- GCP project **`feeder-tc`** (owner fabbari@gmail.com); Sheets, Drive, and
  Picker APIs enabled. No billing attached (none needed).
- OAuth consent screen published (External, Production, `drive.file` only);
  Web client ID `360506420836-tge9cu5lfhf4m3kufl4ist91tri8o9r4.apps.googleusercontent.com`
  with JS origins `http://localhost:5173` and `https://fabbarix.github.io`.
- Picker API key created, referrer-restricted to those origins and
  API-target-restricted to Picker.
- GitHub repo **`fabbarix/feeder-tc`** (public), Pages enabled with Actions
  build source; site URL `https://fabbarix.github.io/feeder-tc/`
  (Vite base path must be `/feeder-tc/`).
- Actions variables `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY` are set
  on the repo; the same values live in the local (gitignored) `.env.local`.
- Local repo initialized on `main` with `origin` → the GitHub repo.

Remaining live-verification step (part of WP-10, needs the product owner at the
browser once): dev-server sign-in + Picker open with a real Google account.

The original responsibility split is kept below for reference in case the
provisioning ever needs to be reproduced:

**User does (interactive, once):**
1. `gcloud auth login` in this session (agent installs the gcloud CLI first if
   absent; no billing account is required — Sheets/Drive/Picker APIs are free).
2. Chooses the GitHub repo name.
3. Consent screen + OAuth client — Google exposes **no public API** for these on
   personal (non-Workspace) accounts, so either:
   - **Path A**: user clicks through Console with agent-dictated values:
     Google Auth Platform → Branding (app name, support email); Audience:
     External → publish to **Production** (allowed without verification for the
     non-sensitive `drive.file` scope; avoids Testing mode's 7-day token expiry);
     Clients → create **Web application** with JS origins
     `http://localhost:5173` and `https://<user>.github.io` (origins are
     scheme+host only — repo name irrelevant here). User hands back the client
     ID (public, not a secret).
   - **Path B**: user grants browser-automation (Claude Chrome extension /
     chrome-devtools MCP) permission for `console.cloud.google.com` and the
     agent drives the same screens in the user's logged-in Chrome.

**Agent automates (once `gcloud auth login` is done):**
1. `gcloud projects create` + set active project.
2. `gcloud services enable sheets.googleapis.com drive.googleapis.com
   picker.googleapis.com`.
3. Picker API key via `gcloud services api-keys create`, restricted to HTTP
   referrers (`https://<user>.github.io/*`, `http://localhost:5173/*`) and
   API-target-restricted to the Picker API.
4. Via `gh`: create the repo, enable Pages (Actions source), set
   `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY` as Actions variables;
   write `.env.local` for dev.
5. Verification: start the dev server and have the user perform one real
   sign-in + Picker open. Never fake or scrape credentials.

Until provisioning completes, WP-10/11 develop and test against mocks; both
values are injected via build-time env vars.

## 8. Glossary

- **Lot** — a discrete quantity of one ingredient acquired at one time, with its own
  location, expiry, and opened state.
- **Viable lot** — a lot whose expiry is on/after the date it would be consumed.
- **Snapshot** — the client-side fold of `InventoryEvents` into current lots.
- **Cursor** — the last `InventoryEvents` row index folded into the snapshot.
- **Generation** — counter in `Meta`; bumped on compaction; mismatch ⇒ full re-read.
- **Outbox** — local queue of pending writes flushed to the Sheets API when online.
- **Staple** — recipe with household flag `staple`; guaranteed weekly placement.
- **Bought meal** — recipe with `kind=bought` (pre-prepared product, prep = 0).
- **Leftover lot** — pantry lot of unit "portion" produced by cooking surplus.
