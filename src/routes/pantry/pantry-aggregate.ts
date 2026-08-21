/**
 * One-row-per-ingredient aggregation for the pantry LIST page (WP-VC4,
 * design/mock-screens.html #pantry: "Rice — Pantry · 1000 g · 2 lots,
 * FIFO — badge Expires Aug 2028 — freshness meter"). The list used to
 * render `group.lots.map(renderRow)` — one row per LOT, so two lots of the
 * same ingredient produced two near-identical rows each carrying its own
 * four action buttons. This module owns turning "an ingredient's lots"
 * into the single summary row the mock actually shows; the per-lot detail
 * (and the lot-scoped actions) moved to the pantry-item route
 * (`PantryItem.tsx`), which consumes `lots`/`soonestLot` from here too.
 */
import { compareIsoDate, compareLotsForFifo } from "../../domain/index.ts";
import type { Ingredient, Lot } from "../../domain/index.ts";

export interface PantryAggregate {
  readonly ingredient: Ingredient;
  /** FIFO order — oldest `purchaseDate` first, i.e. "next out" first. */
  readonly lots: readonly Lot[];
  /** Sum of every lot's amount, in the ingredient's one canonical unit (invariant 3 — never a conversion, just addition of same-unit quantities). */
  readonly totalAmount: number;
  readonly lotCount: number;
  /** The lot expiring soonest — the badge and freshness meter on the aggregated row both read from THIS lot, not the FIFO-first one (they usually coincide, but a correction/expiry-override can make them differ). */
  readonly soonestLot: Lot;
}

/** Builds one `PantryAggregate` per ingredient that has at least one lot. Input order doesn't matter — every list is (re)sorted here. */
export function aggregateByIngredient(
  ingredientsById: ReadonlyMap<string, Ingredient>,
  lots: readonly Lot[],
): readonly PantryAggregate[] {
  const byIngredient = new Map<string, Lot[]>();
  for (const lot of lots) {
    const existing = byIngredient.get(lot.ingredientId);
    if (existing) existing.push(lot);
    else byIngredient.set(lot.ingredientId, [lot]);
  }

  const aggregates: PantryAggregate[] = [];
  for (const [ingredientId, ingredientLots] of byIngredient) {
    const ingredient = ingredientsById.get(ingredientId);
    if (!ingredient) continue; // Same "skip rows with no matching catalog entry" discipline as Pantry.tsx's own lotsWithIngredient build.
    const fifoLots = ingredientLots.slice().sort(compareLotsForFifo);
    const soonestLot = ingredientLots
      .slice()
      .sort((a, b) => compareIsoDate(a.expiry, b.expiry))[0]!;
    aggregates.push({
      ingredient,
      lots: fifoLots,
      totalAmount: ingredientLots.reduce((sum, lot) => sum + lot.quantity.amount, 0),
      lotCount: ingredientLots.length,
      soonestLot,
    });
  }
  return aggregates;
}
