/**
 * Check-off -> purchase-event construction — WP-14 scope item 4:
 * "check-off -> purchase-event construction (needed qty default, actual qty
 * override)".
 *
 * Pure: dates/ids come from the injected `Clock`/`Rng`, never `new Date()`/
 * `Math.random()` (hard rule). "dated today" in the BDD scenario means
 * `clock.today()`.
 */
import { newEventId, newLotId } from "./ids.ts";
import { assertSameUnit } from "./quantity.ts";
import type { PurchaseEvent } from "./types.ts";
import type { Clock, Rng } from "./contracts.ts";
import type { CheckOffInput } from "./shopping-types.ts";

/**
 * Builds the `PurchaseEvent` for checking off one shopping-list line.
 * Defaults the purchased quantity to `input.neededQuantity`; a caller-
 * supplied `actualQuantity` overrides it for package sizes ("needed 400g,
 * bought 1kg" — DESIGN.md §2 "Shopping list"). Both quantities must share
 * the ingredient's one canonical unit (invariant 3) — `assertSameUnit`
 * throws otherwise rather than silently mixing units.
 *
 * This only builds the event; appending it (live, or via the outbox when
 * offline) is the sync layer's job (WP-17), not this pure engine's.
 */
export function checkOffShoppingItem(input: CheckOffInput, clock: Clock, rng: Rng): PurchaseEvent {
  const quantity = input.actualQuantity ?? input.neededQuantity;
  if (input.actualQuantity !== undefined) {
    assertSameUnit(input.neededQuantity, input.actualQuantity, "check-off actual quantity");
  }

  return {
    type: "purchase",
    id: newEventId(rng),
    timestamp: clock.now(),
    ingredientId: input.ingredientId,
    lotId: newLotId(rng),
    quantity,
    location: input.location,
    purchaseDate: clock.today(),
    ...(input.expiryOverride !== undefined ? { expiryOverride: input.expiryOverride } : {}),
  };
}
