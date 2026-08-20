/**
 * Leftover-lot creation helper — WP-12. DESIGN.md §2 "Servings, scaling &
 * leftovers": marking a meal cooked with surplus servings creates a leftover
 * lot (`Leftover: <recipe>`, unit `portion`, short fridge shelf life or
 * frozen).
 *
 * `Lot` has no name field — the "Leftover: <recipe>" display name lives on
 * the catalog `Ingredient` entry the caller resolves/creates for that
 * recipe's leftovers (the same pattern DESIGN.md uses for bought meals: "a
 * single ingredient line pointing to a catalog entry for the product
 * itself"). This helper only knows the `IngredientId` already resolved for
 * that entry, the surplus quantity (computed by the planner/UI from scaled
 * servings minus household size — that scaling math is WP-13's job, not
 * this engine's), and the leftover shelf-life default — which the caller
 * supplies explicitly (from wherever WP-16's seed catalog or its own
 * settings puts it) rather than this module importing WP-16's data, keeping
 * WP-12 unblocked and pure.
 *
 * The only `InventoryEvent` variant that creates a new lot is `purchase`
 * (the union is frozen at six types) — a leftover lot is a purchase event
 * whose `expiryOverride` encodes the leftover default directly, since this
 * module deliberately has no catalog to look up a per-ingredient shelf life
 * from. That necessarily makes `Lot.expiryOverridden` true for every
 * leftover lot; that is a minor semantic reuse of the override channel, not
 * a claim that a human manually edited the expiry.
 */
import { addDays } from "../dates.ts";
import { newEventId, newLotId } from "../ids.ts";
import type { Clock, Rng } from "../contracts.ts";
import type { IngredientId, IsoDate, PurchaseEvent, Quantity, StorageLocation } from "../types.ts";

export interface CreateLeftoverLotInput {
  /** Catalog entry representing "Leftover: <recipe>" (unit `portion`). */
  readonly ingredientId: IngredientId;
  /** Surplus amount, unit `portion` — computed by the planner from scaled servings minus household size. */
  readonly surplusQuantity: Quantity;
  readonly location: StorageLocation;
  /** The meal's cook date — becomes the resulting lot's `purchaseDate`. */
  readonly cookDate: IsoDate;
  /** Leftover shelf-life default in days, supplied by the caller (see module doc comment). */
  readonly shelfLifeDays: number;
}

/**
 * Builds the `PurchaseEvent` that creates a leftover lot. Does not append it
 * anywhere — the caller (WP-17's outbox / sync layer) does that, same as
 * any other event this engine produces. `id`/`lotId` are minted from the
 * injected `Rng`, `timestamp` from the injected `Clock` — never
 * `Math.random()`/`Date.now()` (purity rule), and this keeps leftover-lot
 * creation deterministic and testable under a seeded `Rng`/fixed `Clock`.
 */
export function createLeftoverLot(
  input: CreateLeftoverLotInput,
  clock: Clock,
  rng: Rng,
): PurchaseEvent {
  if (input.surplusQuantity.amount <= 0) {
    throw new Error(
      `createLeftoverLot: surplusQuantity.amount must be > 0, got ${input.surplusQuantity.amount}`,
    );
  }
  return {
    type: "purchase",
    id: newEventId(rng),
    timestamp: clock.now(),
    ingredientId: input.ingredientId,
    lotId: newLotId(rng),
    quantity: input.surplusQuantity,
    location: input.location,
    purchaseDate: input.cookDate,
    expiryOverride: addDays(input.cookDate, input.shelfLifeDays),
  };
}
