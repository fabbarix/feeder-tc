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
