# Meal Planner — Design

A web-based meal planner and pantry-aware shopping list for a household, served from
GitHub Pages, with a Google Sheets workbook as the backend. No server-side code.

## 1. Architecture

- **Frontend**: Vite + React + TypeScript, hash-based routing (GitHub Pages has no
  server rewrites), deployed to Pages via GitHub Actions.
- **Backend**: one Google Sheets workbook per household, accessed **directly from the
  browser** via the Google Sheets REST API. No Apps Script.
- **Auth**: Google Identity Services (OAuth token client) with the **non-sensitive
  `drive.file` scope**. The app can only touch files it created or that the user
  explicitly opened via the Google Picker. No Google verification review, no
  unverified-app warning, no test-user cap.
- **Workbook provisioning**: on first run the app creates the workbook itself and
  writes the schema. The spreadsheet ID is stored in localStorage.
- **Sharing**: the owner shares the workbook through normal Google Sheets sharing.
  A shared user signs in with their own Google account and opens the owner's workbook
  once via the Google Picker (which grants `drive.file` access to it). The app
  supports remembering multiple workbooks and switching between them.
- **PWA + offline**: installable PWA; service worker caches the app shell. Reads are
  served from the localStorage snapshot. Writes (check-offs, usage events, votes,
  plan edits) go into a local **outbox queue** and flush to the Sheets API when
  connectivity returns. Inventory writes are append-only events, so queue replay is
  conflict-free by construction.

### Concurrency model

- **Append-mostly + last-write-wins.** Anything with quantity math or concurrent
  writers (inventory) is an append-only event log; appends from two clients never
  collide. In-place edits (recipes, plan slots, catalog) are last-write-wins with a
  refresh-before-edit. No locking, no version columns — right-sized for a family.
- **Local materialized snapshot.** Clients fold the inventory event log into a local
  snapshot (e.g. `rice: 700g`) kept in localStorage together with a **row-index
  cursor**. Events only append, so on load the client fetches only rows past its
  cursor and folds them in — no full replay.
- **Immutability + generation number.** Event rows are never edited or deleted. A
  `generation` value in the Meta sheet is bumped by any compaction/archival; a client
  whose cached generation mismatches discards localStorage and does a full re-read.

## 2. Domain model

### Ingredients

- Catalog of ingredients, each with exactly **one canonical unit** (tomato: piece,
  rice: g, milk: ml). Recipes, purchases, and pantry all use that unit; all
  aggregation is plain addition; partial usage is fractional (0.5 tomato).
- Shelf life via catalog defaults: `shelf_life_days` (unopened, in its default
  storage location) and `opened_shelf_life_days`, plus `default_location`
  (pantry / fridge / freezer).
- App ships with a pre-seeded catalog (~100 common ingredients) so day one isn't
  data entry.

### Inventory (event-sourced)

- **Lot tracking with FIFO.** Each purchase event creates a lot: ingredient,
  quantity, purchase date, storage location, computed expiry (from catalog
  defaults). Usage consumes oldest-lot-first.
- **Opened state**: opening/cutting a lot re-computes its expiry to the shorter
  `opened_shelf_life_days` (half a tomato doesn't last like a whole one).
- **Freezer**: moving a lot to the freezer suspends expiry (long fixed horizon,
  e.g. 6 months).
- **Overrides**: the user can hand-edit any lot's expiry when reality disagrees.
- Event types: `purchase`, `use`, `spoil`, `adjust`, `move` (location change),
  `open`.
- Users can manually add lots for things already in the pantry/freezer/fridge.

### Recipes

- Fields: name, kind (`cooked` | `bought`), base servings, `prep_minutes`,
  `cook_minutes`, meal-type tags (breakfast / lunch / dinner / snack — multi),
  household status (see Voting), ingredients (join rows), steps (numbered lines).
- **Third-party / pre-prepared meals** are recipes with `kind = bought`:
  `prep_minutes = 0`, a real `cook_minutes`, optional heating instructions as steps
  ("375°, 30 min covered, 20 uncovered"), and a single ingredient line pointing to a
  catalog entry for the product itself ("Store lasagna — piece"). Planning, voting,
  shopping, and mark-cooked use one code path for both kinds.
- Cooked history is tracked (used for "already done" display and the recent-repeat
  exclusion in the generator).

### Servings, scaling & leftovers

- Settings store a household size; recipes store base servings; the planner scales
  ingredient quantities automatically, with a per-slot manual override.
- **Full leftovers tracking**: marking a meal cooked with surplus servings creates a
  leftover lot (`Leftover: <recipe>`, unit = portion, short fridge shelf life, or
  frozen). Leftover lots can fill future meal slots and are consumed like any lot;
  planned leftover slots generate no shopping needs.

### Voting / rotation

- One **household-level 3-state flag** per recipe: `staple` / `in-rotation`
  (default) / `retired`. Anyone with workbook access can flip it. Upvote = staple,
  downvote = retired (out of rotation), no aggregation logic.

### Planning

- Weeks are planned in advance. **Flexible slots**: per-day slot layout
  (breakfast / lunch / dinner / snacks) is configurable in Settings; each slot draws
  only from recipes tagged for its meal type.
- **Generator (staples + weighted random)**, per slot type:
  1. Staples land first, one appearance each per week; more staples than slots →
     round-robin across weeks.
  2. Remaining slots draw randomly from in-rotation recipes, weighted by:
     - strong boost for recipes that consume pantry lots expiring that week
       ("use what you shopped for");
     - mild boost for ingredient overlap with meals already placed that week
       (shrinks the shopping list);
     - exclusion of recipes cooked within the last N weeks (configurable,
       default 3).
  3. Every slot has reroll and pin controls; manual placement always possible.

### Cooking

- Each planned meal has **Mark cooked**: generates FIFO usage events for every
  scaled ingredient, behind a quick confirm screen where amounts can be tweaked or
  items skipped. Surplus servings become a leftover lot. Separate manual entry
  covers ad-hoc usage, spoilage, and corrections.

### Shopping list

- **Needs minus viable stock.** Pick a range — one week or several planned weeks
  (the "monthly" case). The app sums scaled ingredient needs across planned meals,
  then subtracts pantry lots, counting only lots whose expiry is **on or after the
  planned cook date** (a lot expiring Tuesday doesn't cover Friday's dinner). FIFO
  allocation; the remainder is the list, grouped by ingredient, with a per-item
  tooltip showing which meals need it. Recomputed live as the plan changes;
  already-bought items stay checked.
- **In-store check-off creates the lot**: tapping an item marks it bought and
  immediately writes a purchase event pre-filled with the needed amount; a quantity
  field on the row corrects for package sizes (needed 400g, bought 1kg) and the
  surplus becomes pantry stock. Works offline via the outbox queue.
- v1.1 candidate: optional typical package size in the catalog so the list
  pre-rounds to whole packages.

## 3. Workbook schema

One Google Sheets workbook, one sheet (tab) per entity. Human-readable and
hand-editable by design.

| Sheet             | Contents                                                                 |
|-------------------|--------------------------------------------------------------------------|
| `Meta`            | schema version, generation number, app metadata                          |
| `Settings`        | household size, slot layout per day, repeat-exclusion window N           |
| `Ingredients`     | id, name, unit, shelf_life_days, opened_shelf_life_days, default_location |
| `Recipes`         | id, name, kind, servings, prep_minutes, cook_minutes, meal tags, status  |
| `RecipeIngredients` | one row per (recipe_id, ingredient_id, quantity)                       |
| `RecipeSteps`     | one row per (recipe_id, step_no, text)                                   |
| `PlanSlots`       | one row per planned meal: date, slot type, recipe_id, scale, state       |
| `InventoryEvents` | append-only: timestamp, type, ingredient_id, lot_id, qty, location, meta |
| `ShoppingItems`   | current list state: ingredient_id, needed qty, checked, bought qty       |

Recipe ingredients as join rows (not JSON blobs, not wide columns): filterable
("which recipes use tomatoes"), robust against one malformed cell, and trivially
joined in memory since whole sheets are loaded anyway.

## 4. Milestones (foundations-up)

| # | Scope | Usable as |
|---|-------|-----------|
| M1 | OAuth + Picker, workbook bootstrap, ingredients catalog (seeded), recipe CRUD incl. bought meals | a recipe box |
| M2 | Inventory event log, lots, FIFO, shelf life, manual add, snapshot + cursor + generation | a pantry tracker |
| M3 | Planner: flexible slots, 3-state voting, weighted generator, mark-cooked with auto-deduct + leftovers | a meal planner |
| M4 | Shopping list: needs-minus-viable-stock, ranges, in-store check-off creating lots | the full loop |
| M5 | PWA install, service worker, offline outbox, polish | store-proof |

Each milestone is independently usable and builds strictly on the previous one.

## 5. Prerequisites / setup

- A Google Cloud project with the Sheets API, Drive API, and Picker API enabled,
  and an OAuth 2.0 client ID (Web application) whose authorized JavaScript origins
  include the GitHub Pages URL (and `http://localhost:5173` for dev).
- A GitHub repository with Pages enabled, deployed via Actions.

## 6. Explicit non-goals (v1)

- No unit conversion (one canonical unit per ingredient; piece-weight conversion is
  a possible v2).
- No per-user vote aggregation (household-level flag only).
- No nutrition, cost tracking, or recipe import/scraping.
- No Apps Script; no server-side components of any kind.
