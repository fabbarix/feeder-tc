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
