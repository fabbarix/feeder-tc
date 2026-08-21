/**
 * `PriceObservation` construction — M6 (DESIGN_PRODUCTS.md §2/§4).
 *
 * Same shape as `src/domain/inventory/manual-events.ts`'s builders: a pure
 * function that mints `id` from the injected `Rng` and `timestamp` from the
 * injected `Clock`, and returns the row. It never appends anywhere itself —
 * the caller writes it via `WorkbookStore.priceObservations.append` (an
 * append-only sheet, same reasoning as `InventoryEvents`: a price is a
 * point-in-time fact, corrections are new rows, two clients appending never
 * collide).
 *
 * No currency field — the household has exactly one currency
 * (`Settings.currency`), applied at display time only (DESIGN_PRODUCTS.md
 * §4). `quantity` must already be in the linked ingredient's canonical unit
 * (invariant 3) — this module does not convert; the caller (the scan/product
 * editor UI) is responsible for having already gone through
 * `src/domain/units.ts` if the price was entered against a human-typed
 * amount+unit.
 */
import { newPriceObservationId } from "./ids.ts";
import type { Clock, Rng } from "./contracts.ts";
import type { Barcode, IngredientId, PriceObservation, Quantity } from "./types.ts";

export interface BuildPriceObservationInput {
  readonly ingredientId: IngredientId;
  readonly quantity: Quantity;
  readonly price: number;
  /** Which specific product this price was seen on, if scanned rather than entered against a bare ingredient. */
  readonly barcode?: Barcode;
  /** Free-text provenance ("Trader Joe's") — DESIGN_PRODUCTS.md §7 defers a structured `Shops` sheet to M7. */
  readonly source?: string;
}

/** Builds one `PriceObservation` row — "optionally record a new price" at scan/check-off time (DESIGN_PRODUCTS.md §1.3). */
export function buildPriceObservation(input: BuildPriceObservationInput, clock: Clock, rng: Rng): PriceObservation {
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error(`PriceObservation price must be a positive finite number, got ${input.price}`);
  }
  return {
    id: newPriceObservationId(rng),
    timestamp: clock.now(),
    ingredientId: input.ingredientId,
    quantity: input.quantity,
    price: input.price,
    ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
  };
}
