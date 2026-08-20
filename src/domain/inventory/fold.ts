/**
 * The inventory fold — WP-12's other half of the "money logic". Reduces
 * `InventoryEvent[]` onto an existing lots snapshot, applying each event
 * type's semantics in the order given (append order = truth; never resorted
 * by timestamp, since two clients' clocks can disagree but appends cannot
 * collide — HANDOVER.md §4 invariant 4 and DESIGN.md §1 "Concurrency model").
 *
 * Never throws on data it merely disagrees with (an unknown lotId, a
 * use/spoil/adjust that would drive a lot negative, a mixed-unit event) —
 * those produce a `FoldWarning` and the event's effect is skipped or
 * clamped, matching the "a bad row must not take the whole load down"
 * philosophy applied elsewhere (WP-11's codec). It DOES throw when the
 * catalog itself is incomplete for an ingredient a `purchase`/`open`/
 * thaw-`move` event needs shelf-life data for — that is a caller contract
 * violation (the catalog passed in must cover every ingredient referenced
 * by the event stream), not a malformed data row.
 */
import { planFifoConsumption } from "./fifo.ts";
import { computeExpiry, DEFAULT_FREEZER_SUSPENSION_DAYS } from "./expiry.ts";
import { formatQuantity, sameUnit } from "../quantity.ts";
import { makeIsoDate } from "../types.ts";
import type {
  AdjustEvent,
  EventId,
  Ingredient,
  IngredientId,
  InventoryEvent,
  IsoDate,
  IsoTimestamp,
  Lot,
  LotId,
  MoveEvent,
  OpenEvent,
  PurchaseEvent,
  SpoilEvent,
  UseEvent,
} from "../types.ts";

export interface FoldWarning {
  readonly eventId: EventId;
  readonly ingredientId: IngredientId;
  readonly lotId?: LotId;
  readonly reason: string;
}

export interface FoldResult {
  readonly lots: readonly Lot[];
  readonly warnings: readonly FoldWarning[];
}

export interface FoldOptions {
  /** DESIGN.md §2's freezer horizon; defaults to `DEFAULT_FREEZER_SUSPENSION_DAYS`. */
  readonly freezerSuspensionDays?: number;
}

/** First 10 characters of a full ISO timestamp are always `YYYY-MM-DD` (see IsoTimestamp's format). */
function dateOnly(timestamp: IsoTimestamp): IsoDate {
  return makeIsoDate(timestamp.slice(0, 10));
}

function requireIngredient(
  catalog: ReadonlyMap<IngredientId, Ingredient>,
  ingredientId: IngredientId,
  context: string,
): Ingredient {
  const ingredient = catalog.get(ingredientId);
  if (!ingredient) {
    throw new Error(
      `foldInventoryEvents: unknown ingredientId "${ingredientId}" referenced by ${context}; ` +
        "the catalog passed to foldInventoryEvents must include every ingredient referenced by the event stream",
    );
  }
  return ingredient;
}

/**
 * Folds `events` onto `baseLots` (pass `[]` for a from-scratch fold). Pure:
 * no I/O, no wall clock, no randomness — every date/time is read from the
 * events themselves.
 *
 * Precondition the caller must uphold: `events` are in true append order
 * (sheet row order), not sorted by `timestamp`.
 */
export function foldInventoryEvents(
  baseLots: readonly Lot[],
  events: readonly InventoryEvent[],
  catalog: ReadonlyMap<IngredientId, Ingredient>,
  options: FoldOptions = {},
): FoldResult {
  const freezerSuspensionDays = options.freezerSuspensionDays ?? DEFAULT_FREEZER_SUSPENSION_DAYS;
  const lots = new Map<LotId, Lot>(baseLots.map((lot) => [lot.id, lot]));
  const warnings: FoldWarning[] = [];

  const applyPurchase = (event: PurchaseEvent): void => {
    let expiry: IsoDate;
    if (event.expiryOverride !== undefined) {
      expiry = event.expiryOverride;
    } else if (event.location === "freezer") {
      // Purchasing straight into the freezer needs no catalog lookup, same
      // as freezing an existing lot via `move` — the suspension horizon is
      // a fixed policy constant.
      expiry = computeExpiry({ location: "freezer", freshReferenceDate: event.purchaseDate, freezerSuspensionDays });
    } else {
      const ingredient = requireIngredient(catalog, event.ingredientId, `purchase event ${event.id}`);
      expiry = computeExpiry({
        location: event.location,
        freshReferenceDate: event.purchaseDate,
        freezerSuspensionDays,
        ingredient,
      });
    }
    const lot: Lot = {
      id: event.lotId,
      ingredientId: event.ingredientId,
      quantity: event.quantity,
      purchaseDate: event.purchaseDate,
      location: event.location,
      expiry,
      expiryOverridden: event.expiryOverride !== undefined,
    };
    lots.set(event.lotId, lot);
  };

  const applyUse = (event: UseEvent): void => {
    const plan = planFifoConsumption(Array.from(lots.values()), event.ingredientId, event.quantity);
    for (const allocation of plan.allocations) {
      // Non-null: every allocation.lotId came from Array.from(lots.values())
      // above, and nothing else mutates `lots` between that snapshot and
      // this loop, so the lookup can never miss.
      const lot = lots.get(allocation.lotId)!;
      lots.set(lot.id, {
        ...lot,
        quantity: { amount: lot.quantity.amount - allocation.amount, unit: lot.quantity.unit },
      });
    }
    if (plan.shortfall > 0) {
      warnings.push({
        eventId: event.id,
        ingredientId: event.ingredientId,
        reason:
          `use of ${formatQuantity(event.quantity)} exceeds available stock by ` +
          `${plan.shortfall} ${event.quantity.unit}`,
      });
    }
  };

  const applySpoil = (event: SpoilEvent): void => {
    const lot = lots.get(event.lotId);
    if (!lot) {
      warnings.push({
        eventId: event.id,
        ingredientId: event.ingredientId,
        lotId: event.lotId,
        reason: `spoil references unknown lot "${event.lotId}"`,
      });
      return;
    }
    if (!sameUnit(lot.quantity, event.quantity)) {
      warnings.push({
        eventId: event.id,
        ingredientId: event.ingredientId,
        lotId: event.lotId,
        reason: `spoil unit ${event.quantity.unit} does not match lot unit ${lot.quantity.unit}`,
      });
      return;
    }
    const nextAmount = lot.quantity.amount - event.quantity.amount;
    if (nextAmount < 0) {
      warnings.push({
        eventId: event.id,
        ingredientId: event.ingredientId,
        lotId: event.lotId,
        reason: `spoil of ${formatQuantity(event.quantity)} exceeds lot's remaining ${formatQuantity(lot.quantity)}`,
      });
    }
    lots.set(lot.id, {
      ...lot,
      quantity: { amount: Math.max(0, nextAmount), unit: lot.quantity.unit },
    });
  };

  const applyAdjust = (event: AdjustEvent): void => {
    const lot = lots.get(event.lotId);
    if (!lot) {
      warnings.push({
        eventId: event.id,
        ingredientId: event.ingredientId,
        lotId: event.lotId,
        reason: `adjust references unknown lot "${event.lotId}"`,
      });
      return;
    }
    let next: Lot = lot;
    if (event.delta !== undefined) {
      if (!sameUnit(lot.quantity, event.delta)) {
        warnings.push({
          eventId: event.id,
          ingredientId: event.ingredientId,
          lotId: event.lotId,
          reason: `adjust delta unit ${event.delta.unit} does not match lot unit ${lot.quantity.unit}`,
        });
      } else {
        const nextAmount = lot.quantity.amount + event.delta.amount;
        if (nextAmount < 0) {
          warnings.push({
            eventId: event.id,
            ingredientId: event.ingredientId,
            lotId: event.lotId,
            reason: `adjust delta ${formatQuantity(event.delta)} would drive lot "${event.lotId}" negative; clamped to 0`,
          });
        }
        next = { ...next, quantity: { amount: Math.max(0, nextAmount), unit: lot.quantity.unit } };
      }
    }
    if (event.expiry !== undefined) {
      // The only event that can set expiryOverridden=true after purchase time
      // (per types.ts's AdjustEvent doc comment) — a direct, terminal
      // correction to the fold's belief about this lot's expiry.
      next = { ...next, expiry: event.expiry, expiryOverridden: true };
    }
    lots.set(lot.id, next);
  };

  const applyMove = (event: MoveEvent): void => {
    const lot = lots.get(event.lotId);
    if (!lot) {
      warnings.push({
        eventId: event.id,
        ingredientId: event.ingredientId,
        lotId: event.lotId,
        reason: `move references unknown lot "${event.lotId}"`,
      });
      return;
    }
    const wasFrozen = lot.location === "freezer";
    const willBeFrozen = event.location === "freezer";
    const moveDate = dateOnly(event.timestamp);

    if (!wasFrozen && willBeFrozen) {
      // Freezing needs no catalog lookup: the suspension horizon is a fixed
      // policy constant, not a per-ingredient value.
      lots.set(lot.id, {
        ...lot,
        location: event.location,
        expiry: computeExpiry({ location: "freezer", freshReferenceDate: moveDate, freezerSuspensionDays }),
        expiryOverridden: false,
      });
      return;
    }
    if (wasFrozen && !willBeFrozen) {
      // Thawing restarts a fresh countdown from the move date (unopened) or
      // keeps counting from the original openedAt (opened before/while frozen).
      const ingredient = requireIngredient(catalog, lot.ingredientId, `move event ${event.id} (thaw)`);
      lots.set(lot.id, {
        ...lot,
        location: event.location,
        expiry: computeExpiry({
          location: event.location,
          freshReferenceDate: moveDate,
          freezerSuspensionDays,
          ingredient,
          ...(lot.openedAt !== undefined ? { openedAt: lot.openedAt } : {}),
        }),
        expiryOverridden: false,
      });
      return;
    }
    // Both non-freezer (e.g. pantry -> fridge) or both freezer: the catalog
    // only carries one non-frozen shelf-life figure (for the ingredient's
    // default location), so there is no correct number to recompute here.
    // Just relocate the lot; expiry is untouched.
    lots.set(lot.id, { ...lot, location: event.location });
  };

  const applyOpen = (event: OpenEvent): void => {
    const lot = lots.get(event.lotId);
    if (!lot) {
      warnings.push({
        eventId: event.id,
        ingredientId: event.ingredientId,
        lotId: event.lotId,
        reason: `open references unknown lot "${event.lotId}"`,
      });
      return;
    }
    if (lot.openedAt !== undefined) {
      warnings.push({
        eventId: event.id,
        ingredientId: event.ingredientId,
        lotId: event.lotId,
        reason: `lot "${event.lotId}" was already opened on ${lot.openedAt}; duplicate open event ignored`,
      });
      return;
    }
    const openedAt = dateOnly(event.timestamp);
    if (lot.location === "freezer") {
      // Still frozen: record the open date for when it eventually thaws, but
      // the frozen expiry itself is untouched by opening it.
      lots.set(lot.id, { ...lot, openedAt });
      return;
    }
    const ingredient = requireIngredient(catalog, lot.ingredientId, `open event ${event.id}`);
    lots.set(lot.id, {
      ...lot,
      openedAt,
      expiry: computeExpiry({
        location: lot.location,
        openedAt,
        freshReferenceDate: openedAt,
        freezerSuspensionDays,
        ingredient,
      }),
      expiryOverridden: false,
    });
  };

  for (const event of events) {
    switch (event.type) {
      case "purchase":
        applyPurchase(event);
        break;
      case "use":
        applyUse(event);
        break;
      case "spoil":
        applySpoil(event);
        break;
      case "adjust":
        applyAdjust(event);
        break;
      case "move":
        applyMove(event);
        break;
      case "open":
        applyOpen(event);
        break;
    }
  }

  return { lots: Array.from(lots.values()), warnings };
}
