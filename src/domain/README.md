# `src/domain`

Pure domain layer: entity types, interface contracts, injected-nondeterminism
adapters, and (once WP-12/13/14 land) the inventory/planner/shopping engines.

## What lives here

| File / dir | Contents |
|---|---|
| `types.ts` | Every entity and value type: branded ids, `Unit`/`Quantity`, `IsoDate`/`IsoTimestamp`, `Ingredient`, `Recipe`, `RecipeIngredient`, `RecipeStep`, `PlanSlot`, `InventoryEvent` (and its six variants), `Lot`, `Snapshot`, `Settings`, `Meta`, `ShoppingItem`. |
| `contracts.ts` | The six interfaces every implementation and fake conforms to: `SheetsTransport`, `WorkbookStore`, `SnapshotStore`, `Outbox`, `Clock`, `Rng`; plus the shared `DataWarning` / `DecodeResult<T>` / `SyncOutcome` result types. |
| `dates.ts` | Pure `IsoDate` math: `addDays`, `compareIsoDate`, `isBefore`, `isOnOrAfter`, `today(clock)`. |
| `quantity.ts` | Non-converting `Quantity` helpers: `sameUnit`, `assertSameUnit`, `isZero`, `formatQuantity`. No arithmetic, no conversion — see the file header. |
| `units.ts` | **The one sanctioned exception to invariant 3** (M6-A — DESIGN_PRODUCTS.md §3): entry-time-only conversion from a human-entered amount+unit to an ingredient's canonical `Unit`, used solely by the product editor. No engine or codec may import it — see the file header and `eslint.config.js`'s `no-restricted-imports` rule, which enforces that at lint time. |
| `price-normalization.ts` | Pure helper (M6-A) normalising a `PriceObservation` to price-per-100g / per-100ml / per-piece so a 500 g pack and a 1 kg pack are comparable. Not a unit conversion — it never changes `quantity.unit`. |
| `ids.ts` | Client-side id minting (`new*Id(rng)`) built on the injected `Rng`. |
| `clock.ts`, `rng.ts` | The real `Clock`/`Rng` implementations (`systemClock`, `createSeededRng`) — the only two places in this directory allowed to touch the wall clock / a PRNG seed. |
| `fakes/` | In-memory implementations of all six contracts, plus fake `Clock`/`Rng`, exported from `fakes/index.ts`. |
| `contract-tests/` | Shared behavioural suites (`describe*Contract(makeSubject)`) that WP-10/11/17 re-run against their real implementations. |
| `index.ts` | Barrel for everything above **except `fakes/`** — import fakes explicitly from `./fakes`. |

Engines (`inventory` fold/FIFO, `planner` generator, `shopping` allocator —
WP-12/13/14) land in sibling files/dirs here once those work packages merge.

## FROZEN: `types.ts` and `contracts.ts`

**Do not edit `types.ts` or `contracts.ts` as a side effect of a feature
branch.** Seven work packages fan out from WP-02 and code directly against
these exact shapes without the ability to change them. Changes to either file
happen only via a dedicated contract-change task explicitly approved by the
coordinator (see `HANDOVER.md` §6 "Conflict rule"). If your work package
seems to need a new field or a reshaped type here, stop and escalate —
don't widen an interface locally or cast around it.

The helper modules (`dates.ts`, `quantity.ts`, `ids.ts`, `clock.ts`, `rng.ts`)
are not under the same formal freeze, but seven packages depend on them too —
treat a breaking change to their exported signatures with the same caution.

**Post-merge amendments from coordinator review (WP-02 PR #3), both in
`types.ts`, kept here so the reasoning survives:**

- `SpoilEvent` carries a required `lotId`, unlike `UseEvent`. Invariant 4's
  FIFO requirement scopes to "usage, shopping allocation" — spoilage is not
  in that list, and a user identifying a specific mouldy lot on the pantry
  view must be able to name *that* lot rather than have FIFO-oldest guess
  wrong. Do not delete `lotId` to make this symmetric with `UseEvent`.
- `AdjustEvent.delta` is optional and `AdjustEvent.expiry?: IsoDate` was
  added, covering DESIGN.md §2's "the user can hand-edit any lot's expiry
  when reality disagrees" — the only way `Lot.expiryOverridden` can become
  `true` after purchase time. At least one of `delta`/`expiry` must be
  present; construct these via `makeAdjustEvent(...)`, which throws
  otherwise, rather than an object literal. This stays a sixth event type
  reusing `adjust`, not a new seventh kind, per DESIGN.md/WP-02 fixing the
  union at six.

**M6-A contract change (dedicated, coordinator-approved, per DESIGN_PRODUCTS.md), additive-only, both files:**

- `types.ts`: new `Product`, `ProductPhoto`, `PriceObservation` entities;
  new branded `Barcode`/`PriceObservationId` ids; new `EntryUnit` type
  (distinct from `Unit` — `Unit` is untouched); `WorkbookSheetName` gained
  `"Products" | "ProductPhotos" | "PriceObservations"`; `Settings` gained an
  **optional** `currency?: string` field (defaults to `"$"` — see
  `DEFAULT_SETTINGS` and `decodeSettings`) so every pre-existing `Settings`
  object literal across the codebase still type-checks unchanged.
- `contracts.ts`: `WorkbookStore` gained `products` (readAll/upsert),
  `productPhotos` (read-one-by-barcode/upsert — deliberately **no**
  `readAll`, see `ProductPhoto`'s doc comment in `types.ts`), and
  `priceObservations` (readAll/append — append-only, like
  `inventoryEvents`).
- Nothing existing was renamed, removed, or reshaped. `HANDOVER.md` §4
  invariant 3 is amended in scope, not reversed: entry-time conversion is
  now a documented exception, confined to `src/domain/units.ts` and the
  (future, out of scope for M6-A) product editor that calls it.

> **Superseded in part by WP-PHOTO (below):** `ProductPhotos` and the
> `productPhotos` store namespace described above no longer exist — the sheet
> was absorbed into the unified `Photos` sheet. The rest of the M6-A entry
> still stands.

**WP-PHOTO contract change (dedicated, coordinator-approved, per
`DESIGN_PHOTOS.md`), PR #30 — the first change here that is NOT
additive-only. Owner approved the deviation explicitly on 2026-08-21:**

- Why it could not stay additive: `DESIGN_PHOTOS.md` settles on **one**
  `Photos` sheet for every entity's image. Keeping M6-A's per-entity
  `ProductPhotos` alongside it would mean two competing photo pipelines and
  two places to look for the same kind of bytes — the exact duplication the
  design exists to remove. Consolidation therefore requires a removal.
- `types.ts` — **removed:** `"ProductPhotos"` from `WorkbookSheetName`
  (replaced by `"Photos"`), the `ProductPhoto` type, and
  `MAX_PRODUCT_PHOTO_DATA_URL_LENGTH` (replaced by
  `MAX_PHOTO_DATA_URL_LENGTH`, same 50,000 value).
- `types.ts` — **added:** branded `StepId`/`makeStepId`; `PhotoOwnerKind`,
  `PhotoOwnerId`, and the `Photo` entity; optional `hasPhoto?: boolean` on
  `Ingredient` and `Recipe` (render hint only, never a substitute for
  reading the sheet).
- `types.ts` — **reshaped `RecipeStep`:** required `text` renamed to required
  `description`; required `id: StepId` added; optional `detail`,
  `durationMinutes`, `hasPhoto` added. `id` is required *on the type* because
  a step without stable identity is the bug this closes — photos key on `id`,
  never on `stepNumber`, so reordering steps can no longer silently move a
  photo to a different instruction. The `text` → `description` rename was the
  one piece not forced by the design; the owner chose to keep it rather than
  carry two names for the same always-visible instruction line.
- `contracts.ts`: `WorkbookStore.productPhotos` replaced by
  `WorkbookStore.photos` — `get(ownerKind, ownerId)` / `upsert(photo)` /
  `remove(ownerKind, ownerId)`, deliberately **no** `readAll` (a permanent
  decision, not an oversight: bulk-reading every photo is what the lazy
  per-visible-item fetch exists to prevent).
- **Legacy rows still decode — the half of the invariant that was NOT bent.**
  `decodeRecipeStep` reads `description` at column index 2, exactly where the
  old `text` cell sat, so a pre-WP-PHOTO 3-cell row decodes with zero
  migration. A row with no `id` cell gets one minted deterministically by
  `legacyStepId(recipeId, stepNumber)` → `legacy:${recipeId}:${stepNumber}`,
  never randomly — re-reads and separate clients must agree on which step a
  `Photo` belongs to. A pre-existing workbook keeps an orphaned, unread
  `ProductPhotos` tab; nothing ever wrote to it, since the M6 barcode UI is
  unbuilt.

**WP-PURCHASING contract change (dedicated, coordinator-approved, per
DESIGN_PURCHASING.md), additive-only in both files — the pattern M6-A and
WP-VC3 set, unlike WP-PHOTO's necessary exception above:**

- `types.ts`: `Ingredient` gained `purchaseMode?: "whole" | "loose"`,
  `packSize?: Quantity`, `roundTo?: number`, `gramsPerMl?: number`,
  `gramsPerPiece?: number` (§3/§10.1a/§11.3 — `roundTo` shipped even though
  §11.3 defers exposing it in UI, because defining it cost nothing
  additive). `Recipe` gained `indivisible?: boolean` (absent ⇒
  `kind === "bought"`, §4/§8). `RecipeIngredient` gained
  `displayQuantity?: number`/`displayUnit?: EntryUnit`, mirroring
  `Product`'s settled display-pair pattern exactly (§10.3). `ShoppingItem`
  gained `suggestedPurchase?: Quantity`/`purchaseOverride?: Quantity` (§7).
  `EntryUnit` gained `"cup" | "tbsp" | "tsp"` (§10.2 — the US legal set: 1
  cup = 240 ml = 16 tbsp = 48 tsp). `WorkbookSheetName` is untouched — every
  addition is columns on an existing sheet, no new sheet.
- `contracts.ts`: untouched. This package needed no new store namespace.
- New pure engine module `src/domain/purchasing.ts`: `suggestPurchase(need,
  ingredient, product?)` (rounds a need to a purchasable amount — whole-pack
  ceiling or loose-with-optional-roundTo) and `scaleIndivisible(recipe,
  targetServings)` (the fix for "0.5 Store Bought Lasagna" — an indivisible
  recipe scales in whole units, then reports the yield/surplus honestly).
  Wired into `shopping-needs.ts` (indivisible recipes use
  `scaleIndivisible(...).units` as the scale factor instead of the raw
  `targetServings / baseServings`) and `shopping-allocate.ts`
  (`suggestedPurchase` computed exactly once, on the aggregated, post-FIFO
  shortfall — §2.1's "round once, at the end").
- `src/domain/units.ts` (not frozen, but the one sanctioned conversion
  module, lint-enforced): `toCanonicalScale` gained `cup`/`tbsp`/`tsp` as
  exact volume constants; `convertEntryToCanonical` gained an optional third
  `density?: { gramsPerMl?; gramsPerPiece? }` argument enabling the two
  cross-dimension conversions §10.1 documents (volume→mass, count→mass) —
  omitting it (every pre-existing call site does) preserves the exact prior
  "reject a dimension mismatch" behaviour, never a guessed default.
- Sheets: three columns on `Ingredients` (well, five —
  `purchase_mode`/`pack_size_amount`/`pack_size_unit`/`round_to`/
  `grams_per_ml`/`grams_per_piece`), one on `Recipes` (`indivisible`), two on
  `RecipeIngredients` (`display_quantity`/`display_unit`), four on
  `ShoppingItems` (`suggested_purchase_amount`/`_unit`,
  `purchase_override_amount`/`_unit`) — all appended at the end, all
  missing-cell-safe (a legacy row decodes every new field to `undefined`,
  never a thrown error or a quarantined row — see each codec's own tests).
- Left for a later package (editor UI, explicitly out of this package's
  scope): the ingredient editor's "How you buy it"/"How you measure it"
  groups and the recipe editor's "Can't be split" toggle/entry-unit picker.
  The contract fields and engine/units.ts plumbing they need already exist.

**WP-purchasing-editor contract change (dedicated, coordinator-approved, per
DESIGN_PURCHASING.md §8 scope note "one contract field"), additive-only,
`types.ts` only — the same pattern WP-PURCHASING itself set immediately
above, delivering the one field that package left out:**

- `types.ts`: `Ingredient` gained `packLabel?: string` — the container noun
  ("jar", "carton", "box") a `purchaseMode: "whole"` ingredient's shopping
  row calls itself, so the buy-primary number can read "1 jar" instead of
  "250 g" (DESIGN_PURCHASING.md §6). Purely a display label: no engine or
  fold reads it, and it changes no arithmetic — `src/domain/purchasing.ts`'s
  `suggestPurchase` is untouched. Absent means the shopping row falls back to
  the plain formatted amount exactly as it does today (most ingredients
  never set this).
- `contracts.ts`: untouched.
- Sheets: one column on `Ingredients` (`pack_label`), appended at the end
  after `grams_per_piece`, missing-cell-safe like every column before it — a
  legacy row (including one written by the WP-PURCHASING package itself,
  before this field existed) decodes `packLabel` to `undefined`, never a
  thrown error or a quarantined row (see `src/sheets/codecs/ingredients.ts`'s
  `decodeIngredient` and its own tests).
- Wired into the ingredient editor (`src/routes/IngredientEditor.tsx`, "How
  you buy it" group, Whole mode only — same visibility rule as `packSize`)
  and the shopping row's buy-primary display
  (`src/routes/shopping/purchase-display.ts`).

**WP-PRODUCTS-MODEL contract change (dedicated, owner-approved re-key —
explicitly authorised as exceeding the usual additive-only exception; see
the task brief and DESIGN_PRODUCTS.md). The first change here that
re-keys a frozen entity's identity, not just widens it:**

- **Why**: `Product.barcode` WAS the product's identity. The same physical
  product sold under a different barcode in a different shop (the owner's
  own example: tomatoes) became a different `Product` — duplicated
  name/brand/photo/shelf-life, and price history split across rows with no
  way to recombine it. A `Product` now owns a *set* of barcodes.
- `types.ts` — **added**: `ProductId` (branded, client-minted via
  `newProductId`, `src/domain/ids.ts`); `ProductBarcode` (`{ productId,
  barcode }`, one row per barcode — invariant 6, never a delimited list);
  `"ProductBarcodes"` added to `WorkbookSheetName`.
- `types.ts` — **reshaped**: `Product.barcode: Barcode` **removed**,
  replaced by `Product.id: ProductId`. `PhotoOwnerId`'s `Barcode` member
  replaced by `ProductId` (a product's photo now keys on its identity, not
  on any one barcode it happens to be sold under).
  `PriceObservation.barcode` is **unchanged** — an observation genuinely
  happened at a specific barcode; resolving it to a product is a lookup
  (`src/domain/products.ts`'s `resolveProductId`) over `ProductBarcodes`,
  never a rewrite of `PriceObservation` itself.
- **Legacy rows still decode with ZERO row-shape change**: a pre-re-key
  `Products` row's column 0 held a `Barcode` string (6-14 digits), which is
  always a non-empty string and therefore already a valid `ProductId`
  (`makeProductId`'s rules are a strict subset of `makeBarcode`'s) — so
  `decodeProduct` reads it unchanged, just under a different name/type.
  Same reasoning fixes `src/sheets/codecs/photos.ts`'s `decodeOwnerId` for
  `ownerKind: "product"`. What a legacy workbook is actually MISSING is the
  `ProductBarcode` row linking that same string back to itself as a
  barcode — `src/domain/products.ts`'s `migrateLegacyProductBarcodes`
  computes exactly those rows (idempotent, additive-only, never touches a
  product that already has one), run via
  `src/sheets/product-barcode-migration.ts`'s `runProductBarcodeMigration`
  every time a workbook is opened (`App.tsx`, chained after
  `ensureWorkbookSchema`).
- `contracts.ts`: `WorkbookStore` gained `productBarcodes`
  (`readAll`/`upsert` — insert-or-replace **by barcode**, since a barcode
  belongs to exactly one product and reassigning it during a merge
  overwrites its row rather than duplicating it; deliberately no `remove`).
  `products.upsert` is now insert-or-replace by `id`, not `barcode`.
- New pure domain module `src/domain/products.ts`: barcode↔product
  resolution (`resolveProductId`, `buildBarcodeIndex`, `barcodesForProduct`,
  `observationsForProduct`); the legacy migration computation
  (`migrateLegacyProductBarcodes`); duplicate-merge **detection only**
  (`suggestProductMerges` — same ingredient + same canonical package size
  (±2%, tolerating unit-conversion rounding) + overlapping names
  (token-Jaccard ≥ 0.5), biased hard toward under-suggesting because a
  wrong confident merge prompt is worse than a missed one); and
  `planProductMerge`, which computes the barcode reassignments a confirmed
  merge needs to write (never applies them — no UI ships in this package).
  Fully unit-tested in `src/domain/products.test.ts`, including the
  idempotency/non-destructiveness properties the migration promises.
- Sheets: new `ProductBarcodes` sheet (`product_id, barcode`) —
  `src/sheets/codecs/product-barcodes.ts`. `Products`' header is unchanged
  in shape; column 0 is relabelled `id` (was `barcode`).
- Source capture (the chart the owner picked had no data —
  `PriceObservation.source` was written in exactly one place, a test): the
  scan flow's product editor and known-product confirm dialog, and the
  shopping route's check-off sheet, now offer an optional free-text "Where
  did you buy this?" field, pre-populated as datalist suggestions from
  every distinct `source` already recorded (most-recently-used first) —
  never a picklist, per DESIGN_PRODUCTS.md §7 deferring a structured
  `Shops` sheet to M7.
- Left for the follow-up UI task (explicitly out of this package's scope,
  per the task brief): the products screen itself (list/edit/combine), and
  re-grouping the existing price-history views by `ProductId`/shop rather
  than by barcode — `aggregateByProduct`
  (`src/routes/products/price-history-aggregate.ts`) still groups by
  barcode, so a merged product's several barcodes currently render as
  separate summaries rather than one combined line. Nothing is lost (every
  observation is still shown, under whichever barcode it named), it just
  isn't combined into the one-line-per-product view yet.

## The purity rule

Every module in `src/domain` is pure: no I/O, no React, no browser/Node
globals, no `Date.now()`, no `Math.random()`. The **only** two exceptions,
by design, are `clock.ts` (`systemClock`, which reads the wall clock) and
`rng.ts` (`createSeededRng`, which is deterministic given a seed but is
where a real, unseeded-by-us source of entropy would be plugged in by
whichever layer bootstraps the app). Every other module — including every
future engine — takes `Clock`/`Rng` as an injected parameter instead of
reaching for either directly. This is what makes the inventory fold, the
planner generator, and the shopping allocator unit-testable and
reproducible (WP-13's generator BDD runs 1000 seeded weeks and expects the
same weeks back every run).

## The dependency-direction rule

Dependencies point inward only. Nothing in `src/domain` may import from
`src/sheets`, `src/sync`, `src/ui`, or `src/routes`. Those layers import
*from* `src/domain`, never the reverse. Within `src/domain` itself:

```
types.ts  (zero imports)
   ^
contracts.ts  (imports types.ts)
   ^
dates.ts, quantity.ts  (import types.ts)
   ^
ids.ts, clock.ts, rng.ts  (import types.ts + contracts.ts)
   ^
fakes/*, contract-tests/*  (import types.ts + contracts.ts, and each other)
```

`index.ts` re-exports everything above **except `fakes/`** — production code
that imports `src/domain` can never accidentally pull in a test double.
Import fakes explicitly: `import { createFakeWorkbookStore } from
"<path-to>/domain/fakes"`.
