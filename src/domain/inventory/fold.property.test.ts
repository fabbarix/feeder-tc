/**
 * Property test protecting HANDOVER.md §4 invariant 2 in practice
 * (IMPLEMENTATION_PLAN.md WP-12): folding a whole event log in one pass must
 * equal folding it incrementally in arbitrary chunks via the cursor —
 * `createApplyNewEvents`'s cursor arithmetic must be a true left-fold, not
 * something that only happens to work for the hand-picked BDD scenarios.
 *
 * Randomised, not hand-picked: fast-check generates an arbitrary sequence of
 * every InventoryEvent kind (referencing lots/ingredients that may or may
 * not exist yet — a `spoil`/`move`/`open`/`use` on a not-yet-created lot is
 * valid input, it just produces a `FoldWarning`), then an arbitrary way to
 * cut that sequence into chunks, and asserts the incrementally-synced
 * snapshot's lots are deep-equal to the one-pass fold's lots, for 300 random
 * cases per run.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays } from "../dates.ts";
import { compareLotsForFifo } from "./fifo.ts";
import { foldInventoryEvents } from "./fold.ts";
import { createApplyNewEvents } from "./sync.ts";
import {
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makeQuantity,
  type Ingredient,
  type IngredientId,
  type InventoryEvent,
  type IsoDate,
  type LotId,
  type Meta,
  type Snapshot,
  type StorageLocation,
} from "../types.ts";

const INGREDIENT_IDS = [makeIngredientId("prop-rice"), makeIngredientId("prop-tomato")] as const;
const LOT_IDS = [0, 1, 2, 3].map((n) => makeLotId(`prop-lot-${n}`));
const LOCATIONS: readonly StorageLocation[] = ["pantry", "fridge", "freezer"];
const BASE_DATE = makeIsoDate("2026-01-01");

const catalog: ReadonlyMap<(typeof INGREDIENT_IDS)[number], Ingredient> = new Map(
  INGREDIENT_IDS.map((id, i) => [
    id,
    {
      id,
      name: id,
      unit: "g",
      shelfLifeDays: 10 + i * 5,
      openedShelfLifeDays: 2 + i,
      defaultLocation: "pantry",
    },
  ]),
);

// --- Event spec arbitraries -------------------------------------------------
// Specs carry everything except `id`/`timestamp`, which are assigned
// centrally afterward so every event in a sequence has a unique id and a
// strictly increasing timestamp regardless of what fast-check generated.

interface PurchaseSpec {
  readonly kind: "purchase";
  readonly ingredientIdx: 0 | 1;
  readonly lotIdx: 0 | 1 | 2 | 3;
  readonly amount: number;
  readonly location: StorageLocation;
  readonly purchaseDateOffset: number;
  readonly expiryOverrideOffset: number | undefined;
}
interface UseSpec {
  readonly kind: "use";
  readonly ingredientIdx: 0 | 1;
  readonly amount: number;
}
interface SpoilSpec {
  readonly kind: "spoil";
  readonly ingredientIdx: 0 | 1;
  readonly lotIdx: 0 | 1 | 2 | 3;
  readonly amount: number;
}
interface AdjustSpec {
  readonly kind: "adjust";
  readonly ingredientIdx: 0 | 1;
  readonly lotIdx: 0 | 1 | 2 | 3;
  readonly deltaAmount: number | undefined;
  readonly expiryOffset: number | undefined;
}
interface MoveSpec {
  readonly kind: "move";
  readonly ingredientIdx: 0 | 1;
  readonly lotIdx: 0 | 1 | 2 | 3;
  readonly location: StorageLocation;
}
interface OpenSpec {
  readonly kind: "open";
  readonly ingredientIdx: 0 | 1;
  readonly lotIdx: 0 | 1 | 2 | 3;
}

type EventSpec = PurchaseSpec | UseSpec | SpoilSpec | AdjustSpec | MoveSpec | OpenSpec;

const ingredientIdxArb = fc.constantFrom(0 as const, 1 as const);
const lotIdxArb = fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const);
const locationArb = fc.constantFrom(...LOCATIONS);
const amountArb = fc.integer({ min: 1, max: 500 });

const purchaseSpecArb: fc.Arbitrary<PurchaseSpec> = fc.record({
  kind: fc.constant("purchase"),
  ingredientIdx: ingredientIdxArb,
  lotIdx: lotIdxArb,
  amount: amountArb,
  location: locationArb,
  purchaseDateOffset: fc.integer({ min: 0, max: 60 }),
  expiryOverrideOffset: fc.option(fc.integer({ min: 1, max: 400 }), { nil: undefined }),
});

const useSpecArb: fc.Arbitrary<UseSpec> = fc.record({
  kind: fc.constant("use"),
  ingredientIdx: ingredientIdxArb,
  amount: amountArb,
});

const spoilSpecArb: fc.Arbitrary<SpoilSpec> = fc.record({
  kind: fc.constant("spoil"),
  ingredientIdx: ingredientIdxArb,
  lotIdx: lotIdxArb,
  amount: amountArb,
});

const adjustSpecArb: fc.Arbitrary<AdjustSpec> = fc
  .record({
    kind: fc.constant("adjust" as const),
    ingredientIdx: ingredientIdxArb,
    lotIdx: lotIdxArb,
    deltaAmount: fc.option(fc.integer({ min: -300, max: 300 }), { nil: undefined }),
    expiryOffset: fc.option(fc.integer({ min: 1, max: 400 }), { nil: undefined }),
  })
  // AdjustEvent requires at least one of delta/expiry — retry-filter rather
  // than special-case a default, so the generator still explores the full
  // space of "delta only" / "expiry only" / "both" combinations.
  .filter((s) => s.deltaAmount !== undefined || s.expiryOffset !== undefined);

const moveSpecArb: fc.Arbitrary<MoveSpec> = fc.record({
  kind: fc.constant("move"),
  ingredientIdx: ingredientIdxArb,
  lotIdx: lotIdxArb,
  location: locationArb,
});

const openSpecArb: fc.Arbitrary<OpenSpec> = fc.record({
  kind: fc.constant("open"),
  ingredientIdx: ingredientIdxArb,
  lotIdx: lotIdxArb,
});

const eventSpecArb: fc.Arbitrary<EventSpec> = fc.oneof(
  purchaseSpecArb,
  useSpecArb,
  spoilSpecArb,
  adjustSpecArb,
  moveSpecArb,
  openSpecArb,
);

function timestampAt(index: number): ReturnType<typeof makeIsoTimestamp> {
  const millis = Date.UTC(2026, 0, 1, 0, 0, 0) + index * 1000;
  return makeIsoTimestamp(new Date(millis).toISOString());
}

function purchaseDateFor(offset: number): IsoDate {
  return addDays(BASE_DATE, offset);
}

// `noUncheckedIndexedAccess` types every array index access as possibly
// `undefined`, even for these fixed-size pools indexed by a literal union —
// these two helpers assert what's structurally guaranteed (`ingredientIdx`/
// `lotIdx` are drawn only from `0..INGREDIENT_IDS.length-1`/`0..LOT_IDS.length-1`).
function ingredientIdAt(idx: 0 | 1): IngredientId {
  return INGREDIENT_IDS[idx]!;
}
function lotIdAt(idx: 0 | 1 | 2 | 3): LotId {
  return LOT_IDS[idx]!;
}

function buildEvents(specs: readonly EventSpec[]): InventoryEvent[] {
  return specs.map((spec, index): InventoryEvent => {
    const id = makeEventId(`prop-evt-${index}`);
    const timestamp = timestampAt(index);
    const ingredientId = ingredientIdAt(spec.ingredientIdx);

    switch (spec.kind) {
      case "purchase": {
        const purchaseDate = purchaseDateFor(spec.purchaseDateOffset);
        return {
          type: "purchase",
          id,
          timestamp,
          ingredientId,
          lotId: lotIdAt(spec.lotIdx),
          quantity: makeQuantity(spec.amount, "g"),
          location: spec.location,
          purchaseDate,
          ...(spec.expiryOverrideOffset !== undefined
            ? { expiryOverride: addDays(purchaseDate, spec.expiryOverrideOffset) }
            : {}),
        };
      }
      case "use":
        return {
          type: "use",
          id,
          timestamp,
          ingredientId,
          quantity: makeQuantity(spec.amount, "g"),
        };
      case "spoil":
        return {
          type: "spoil",
          id,
          timestamp,
          ingredientId,
          lotId: lotIdAt(spec.lotIdx),
          quantity: makeQuantity(spec.amount, "g"),
        };
      case "adjust":
        return {
          type: "adjust",
          id,
          timestamp,
          ingredientId,
          lotId: lotIdAt(spec.lotIdx),
          ...(spec.deltaAmount !== undefined ? { delta: makeQuantity(spec.deltaAmount, "g") } : {}),
          ...(spec.expiryOffset !== undefined ? { expiry: addDays(BASE_DATE, spec.expiryOffset) } : {}),
        };
      case "move":
        return {
          type: "move",
          id,
          timestamp,
          ingredientId,
          lotId: lotIdAt(spec.lotIdx),
          location: spec.location,
        };
      case "open":
        return {
          type: "open",
          id,
          timestamp,
          ingredientId,
          lotId: lotIdAt(spec.lotIdx),
        };
    }
  });
}

/** A sequence of events plus an arbitrary way to cut it into 1..N chunks. */
const scenarioArb = fc
  .array(eventSpecArb, { minLength: 0, maxLength: 40 })
  .chain((specs) =>
    fc.record({
      specs: fc.constant(specs),
      // One boolean per gap between consecutive events: true = cut here.
      cuts: fc.array(fc.boolean(), {
        minLength: Math.max(specs.length - 1, 0),
        maxLength: Math.max(specs.length - 1, 0),
      }),
    }),
  );

function splitIntoChunks<T>(items: readonly T[], cutAfterIndex: readonly boolean[]): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  let current: T[] = [];
  items.forEach((item, i) => {
    current.push(item);
    if (cutAfterIndex[i] === true) {
      chunks.push(current);
      current = [];
    }
  });
  chunks.push(current);
  return chunks;
}

describe("fold composability property", () => {
  it("one-pass fold equals incremental fold via cursor, for arbitrary event sequences and chunking", () => {
    fc.assert(
      fc.property(scenarioArb, ({ specs, cuts }) => {
        const events = buildEvents(specs);
        const generation = 1;
        const meta: Meta = { schemaVersion: 1, generation };

        const onePass = foldInventoryEvents([], events, catalog).lots;

        const applyNewEvents = createApplyNewEvents(catalog);
        let snapshot: Snapshot = { generation, cursor: 0, lots: [] };
        for (const chunk of splitIntoChunks(events, cuts)) {
          const outcome = applyNewEvents(snapshot, chunk, meta);
          expect(outcome.kind).toBe("applied");
          if (outcome.kind === "applied") {
            snapshot = outcome.snapshot;
          }
        }

        expect(snapshot.cursor).toBe(events.length);
        // Order-independent comparison: chunk boundaries can change which
        // Map insertion order the incremental run produces relative to the
        // one-pass run when a lotId is reused across chunks, so compare as
        // sets keyed by lotId (still a strong check — every lot's full
        // field-by-field state must match) rather than requiring identical
        // array order.
        const sortByLotId = (lots: typeof onePass) => [...lots].sort(compareLotsForFifo);
        expect(sortByLotId(snapshot.lots)).toEqual(sortByLotId(onePass));
      }),
      { numRuns: 300 },
    );
  });
});
