/**
 * Pure FIFO consumption allocator — WP-12, the "money logic" invariant 4
 * exists to protect: quantities are always consumed oldest-lot-first by
 * `purchaseDate`, never by event-append order or lot-creation order.
 *
 * Deliberately standalone from `fold.ts` (rather than inlined into the
 * `use`-event handler) so it is directly unit-testable to 100% branch
 * coverage on its own, and so a caller that wants to *preview* a FIFO
 * allocation before submitting a usage event (e.g. WP-21's manual usage
 * entry) can call it without going through the full fold.
 */
import { compareIsoDate } from "../dates.ts";
import { sameUnit } from "../quantity.ts";
import type { IngredientId, LotId, Lot, Quantity } from "../types.ts";

export interface FifoAllocation {
  readonly lotId: LotId;
  /** Amount taken from this lot; always > 0 and always in `quantity`'s unit. */
  readonly amount: number;
}

export interface FifoPlan {
  /** Ordered oldest-lot-first; empty if nothing could be allocated. */
  readonly allocations: readonly FifoAllocation[];
  /** Amount that could not be satisfied by any lot (0 if fully satisfied). */
  readonly shortfall: number;
}

/**
 * FIFO ordering: oldest `purchaseDate` first; ties break on `lotId` (string
 * order) so the plan is fully deterministic regardless of the input array's
 * order — required for the fold's one-pass-equals-incremental property to
 * hold regardless of how a snapshot's lots array happens to be ordered.
 *
 * Exported as a standalone, directly-callable comparator (rather than left
 * inline inside `.sort()`) so every branch — including the `lotId` tie-break
 * and the fully-equal case — is exercised by an explicit unit test instead
 * of depending on how many times, or in what argument order, a JS engine's
 * sort implementation happens to invoke an inline comparator for a given
 * input size.
 */
export function compareLotsForFifo(a: Lot, b: Lot): -1 | 0 | 1 {
  const byDate = compareIsoDate(a.purchaseDate, b.purchaseDate);
  if (byDate !== 0) return byDate;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Plans a FIFO consumption of `quantity` against `lots` filtered to
 * `ingredientId`, oldest-lot-first (see `compareLotsForFifo`).
 *
 * Pure: does not mutate `lots`; the caller applies the returned plan.
 */
export function planFifoConsumption(
  lots: readonly Lot[],
  ingredientId: IngredientId,
  quantity: Quantity,
): FifoPlan {
  if (quantity.amount < 0) {
    throw new Error(
      `planFifoConsumption: quantity.amount must be >= 0, got ${quantity.amount}`,
    );
  }

  const candidates = lots
    .filter((lot) => lot.ingredientId === ingredientId && lot.quantity.amount > 0)
    .slice()
    .sort(compareLotsForFifo);

  const allocations: FifoAllocation[] = [];
  let remaining = quantity.amount;

  for (const lot of candidates) {
    if (remaining <= 0) break;
    if (!sameUnit(quantity, lot.quantity)) {
      throw new Error(
        `planFifoConsumption: mixed units for ingredient "${ingredientId}": requested ${quantity.unit}, lot "${lot.id}" holds ${lot.quantity.unit}`,
      );
    }
    const take = Math.min(lot.quantity.amount, remaining);
    allocations.push({ lotId: lot.id, amount: take });
    remaining -= take;
  }

  return { allocations, shortfall: remaining };
}
