/**
 * Price normalisation (M6-A — DESIGN_PRODUCTS.md §4): comparing a 500 g pack
 * against a 1 kg pack needs a common base for the price fluctuation to mean
 * anything. This normalises one `PriceObservation` to price-per-100g,
 * price-per-100ml, or price-per-piece, matching its `quantity.unit`.
 *
 * Pure and deterministic — no `Date.now()`, no I/O, nothing but arithmetic
 * on the fields already on the observation. This is NOT the conversion
 * exception in src/domain/units.ts: it never turns one `Unit` into another,
 * it only rescales an amount that is already in the observation's own
 * canonical unit (invariant 3 is untouched — `quantity.unit` stays whatever
 * it was).
 */
import type { PriceObservation } from "./types.ts";

export type NormalizedPriceBasis = "per-100g" | "per-100ml" | "per-piece";

export interface NormalizedPrice {
  readonly basis: NormalizedPriceBasis;
  /** Price in the household's single currency (Settings.currency), per the basis above. */
  readonly amount: number;
}

/**
 * Normalises one observation. Throws if `quantity.amount` is not a positive
 * finite number (a zero/negative package size makes "price per 100g"
 * undefined, not zero or infinite) — this mirrors the codec-layer guard
 * `decodePriceObservation` already applies on read, so a caller working
 * purely at the domain level gets the same protection.
 */
export function normalizePrice(observation: PriceObservation): NormalizedPrice {
  const { quantity, price } = observation;
  if (!Number.isFinite(quantity.amount) || quantity.amount <= 0) {
    throw new Error(`Cannot normalize a price observation with a non-positive quantity, got ${quantity.amount}`);
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`Cannot normalize a price observation with an invalid price, got ${price}`);
  }

  switch (quantity.unit) {
    case "g":
      return { basis: "per-100g", amount: (price / quantity.amount) * 100 };
    case "ml":
      return { basis: "per-100ml", amount: (price / quantity.amount) * 100 };
    case "piece":
      return { basis: "per-piece", amount: price / quantity.amount };
    case "portion":
      // A price is never observed against a leftover-lot; guard rather than
      // silently producing a meaningless "per-100portion" figure.
      throw new Error('Cannot normalize a price observation whose quantity unit is "portion" (leftover-lot-only unit, never a purchased quantity).');
  }
}
