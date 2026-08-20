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
