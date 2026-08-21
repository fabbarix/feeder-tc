/**
 * Currency/basis display helpers for the price-history view. `symbol` is
 * always the caller's `Settings.currency` (default `"$"` per
 * DESIGN_PRODUCTS.md §4) — this module never hardcodes one itself, and
 * never reads Settings directly (UI_DESIGN.md §7: data arrives via props,
 * not via a store import inside `src/ui/**`-adjacent presentational code).
 */
import type { NormalizedPriceBasis } from "../../domain/price-normalization.ts";

/** "$1.20" — two decimal places regardless of magnitude, matching how a price tag reads. */
export function formatMoney(amount: number, symbol: string): string {
  return `${symbol}${amount.toFixed(2)}`;
}

const BASIS_LABEL: Record<NormalizedPriceBasis, string> = {
  "per-100g": "per 100 g",
  "per-100ml": "per 100 ml",
  "per-piece": "per piece",
};

/** "per 100 g" / "per 100 ml" / "per piece" — human label for a `NormalizedPriceBasis`. */
export function basisLabel(basis: NormalizedPriceBasis): string {
  return BASIS_LABEL[basis];
}
