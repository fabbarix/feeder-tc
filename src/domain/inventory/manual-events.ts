/**
 * Manual `InventoryEvent` builders — WP-21's pantry UI actions (add-lot,
 * usage, spoilage, correct, move, open). Same shape as `leftovers.ts`'s
 * `createLeftoverLot`: pure functions that mint `id`/`lotId` from the
 * injected `Rng` and `timestamp` from the injected `Clock`, and return the
 * event. They never append anywhere themselves — the caller's `Outbox`
 * does that (HANDOVER.md invariant 9: every offline write is an event
 * appended via the outbox).
 *
 * `UseEvent` deliberately carries no `lotId` — FIFO allocation is resolved
 * at fold time (`fifo.ts`/`fold.ts`), never chosen by the caller, so
 * `buildUseEvent` has no lot parameter to accept. `SpoilEvent` DOES carry a
 * `lotId` — spoilage names the specific lot the user is looking at — so
 * `buildSpoilEvent` requires one. This asymmetry is deliberate (see
 * `src/domain/README.md`'s "Post-merge amendments" note) and is not
 * "fixed" here to look symmetric.
 *
 * "Correct", not "Edit": invariant 1 forbids editing an immutable
 * `InventoryEvents` row. `buildCorrectEvent` always mints a brand-new
 * `adjust` event (via `makeAdjustEvent`, which throws unless at least one
 * of `delta`/`expiry` is supplied) — there is no update-in-place path.
 */
import { newEventId, newLotId } from "../ids.ts";
import { makeAdjustEvent } from "../types.ts";
import type { Clock, Rng } from "../contracts.ts";
import type {
  AdjustEvent,
  IngredientId,
  IsoDate,
  LotId,
  MoveEvent,
  OpenEvent,
  PurchaseEvent,
  Quantity,
  SpoilEvent,
  StorageLocation,
  UseEvent,
} from "../types.ts";

export interface BuildPurchaseEventInput {
  readonly ingredientId: IngredientId;
  readonly quantity: Quantity;
  readonly location: StorageLocation;
  readonly purchaseDate: IsoDate;
  /** Manual expiry override at add-lot time — e.g. a best-guess for stock already in the pantry. */
  readonly expiryOverride?: IsoDate;
}

/** "Already in my pantry" / any other add-lot action — always a fresh lot, never merged into an existing one (each purchase is its own lot, DESIGN.md §2). */
export function buildPurchaseEvent(input: BuildPurchaseEventInput, clock: Clock, rng: Rng): PurchaseEvent {
  return {
    type: "purchase",
    id: newEventId(rng),
    timestamp: clock.now(),
    ingredientId: input.ingredientId,
    lotId: newLotId(rng),
    quantity: input.quantity,
    location: input.location,
    purchaseDate: input.purchaseDate,
    ...(input.expiryOverride !== undefined ? { expiryOverride: input.expiryOverride } : {}),
  };
}

export interface BuildUseEventInput {
  readonly ingredientId: IngredientId;
  readonly quantity: Quantity;
}

/** Manual "use some" — no `lotId` parameter; FIFO decides which lot(s) it comes from at fold time (invariant 4). */
export function buildUseEvent(input: BuildUseEventInput, clock: Clock, rng: Rng): UseEvent {
  return {
    type: "use",
    id: newEventId(rng),
    timestamp: clock.now(),
    ingredientId: input.ingredientId,
    quantity: input.quantity,
  };
}

export interface BuildSpoilEventInput {
  readonly ingredientId: IngredientId;
  readonly lotId: LotId;
  readonly quantity: Quantity;
}

/** "Mark spoiled" — always names the specific `lotId` the user is looking at. */
export function buildSpoilEvent(input: BuildSpoilEventInput, clock: Clock, rng: Rng): SpoilEvent {
  return {
    type: "spoil",
    id: newEventId(rng),
    timestamp: clock.now(),
    ingredientId: input.ingredientId,
    lotId: input.lotId,
    quantity: input.quantity,
  };
}

export interface BuildMoveEventInput {
  readonly ingredientId: IngredientId;
  readonly lotId: LotId;
  readonly location: StorageLocation;
}

/** Relocates one lot; freezing/thawing expiry recomputation is `fold.ts`'s job, not this builder's. */
export function buildMoveEvent(input: BuildMoveEventInput, clock: Clock, rng: Rng): MoveEvent {
  return {
    type: "move",
    id: newEventId(rng),
    timestamp: clock.now(),
    ingredientId: input.ingredientId,
    lotId: input.lotId,
    location: input.location,
  };
}

export interface BuildOpenEventInput {
  readonly ingredientId: IngredientId;
  readonly lotId: LotId;
}

export function buildOpenEvent(input: BuildOpenEventInput, clock: Clock, rng: Rng): OpenEvent {
  return {
    type: "open",
    id: newEventId(rng),
    timestamp: clock.now(),
    ingredientId: input.ingredientId,
    lotId: input.lotId,
  };
}

export interface BuildCorrectEventInput {
  readonly ingredientId: IngredientId;
  readonly lotId: LotId;
  readonly delta?: Quantity;
  readonly expiry?: IsoDate;
  readonly reason?: string;
}

/**
 * "Correct" (never "Edit" — invariant 1): mints a new `adjust` event
 * against `lotId`. Setting `expiry` here is the only way to override a
 * lot's expiry after purchase time — `fold.ts` sets `Lot.expiryOverridden`
 * whenever it applies one. Delegates to `makeAdjustEvent`, which throws if
 * neither `delta` nor `expiry` is supplied.
 */
export function buildCorrectEvent(input: BuildCorrectEventInput, clock: Clock, rng: Rng): AdjustEvent {
  return makeAdjustEvent({
    id: newEventId(rng),
    timestamp: clock.now(),
    ingredientId: input.ingredientId,
    lotId: input.lotId,
    ...(input.delta !== undefined ? { delta: input.delta } : {}),
    ...(input.expiry !== undefined ? { expiry: input.expiry } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  });
}
