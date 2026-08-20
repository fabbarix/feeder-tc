/**
 * Viable-stock subtraction + FIFO allocation — WP-14, scope items 2 and 3:
 * "viable-stock subtraction (lot counts only if expiry >= cook date), FIFO
 * allocation across meals in date order; list grouping with per-item meal
 * provenance."
 *
 * Pure and order-stable: the output depends only on the *values* in `needs`
 * and `lots`, never on the order those arrays arrive in. Every grouping is
 * keyed and every list that matters for the result (needs within an
 * ingredient, lots within an ingredient, output lines, output sources) is
 * explicitly sorted by content before use — see `NEED_ORDER`/`LOT_ORDER` and
 * the sorts in `allocateShoppingList`. This is what "Allocator is pure and
 * order-stable" (IMPLEMENTATION_PLAN.md WP-14 success criteria) means in
 * practice: shuffle any input array and the result is byte-identical.
 */
import type { Lot, MealTag, Unit } from "./types.ts";
import { makeQuantity } from "./types.ts";
import { compareIsoDate, isOnOrAfter } from "./dates.ts";
import type { DateRange, ShoppingListLine, ShoppingNeed, ShoppingNeedSource } from "./shopping-types.ts";

const MEAL_TAG_ORDER: Record<MealTag, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  snack: 3,
};

/**
 * Total order over needs for one ingredient: cook date first ("FIFO
 * allocation across meals in date order"), then a fully deterministic
 * tie-break so two needs on the same date never depend on input order.
 */
function compareNeed(a: ShoppingNeed, b: ShoppingNeed): number {
  const byDate = compareIsoDate(a.source.date, b.source.date);
  if (byDate !== 0) return byDate;
  const byMealTag = MEAL_TAG_ORDER[a.source.slotType] - MEAL_TAG_ORDER[b.source.slotType];
  if (byMealTag !== 0) return byMealTag;
  const bySlotIndex = a.source.slotIndex - b.source.slotIndex;
  if (bySlotIndex !== 0) return bySlotIndex;
  const byRecipeId = a.source.recipeId.localeCompare(b.source.recipeId);
  if (byRecipeId !== 0) return byRecipeId;
  return a.source.planSlotId.localeCompare(b.source.planSlotId);
}

/**
 * FIFO order over lots of one ingredient: oldest purchase first (invariant
 * 4), tie-broken by lot id for full determinism when two lots share a
 * purchase date.
 */
function compareLotFifo(a: Lot, b: Lot): number {
  const byPurchaseDate = compareIsoDate(a.purchaseDate, b.purchaseDate);
  if (byPurchaseDate !== 0) return byPurchaseDate;
  return a.id.localeCompare(b.id);
}

function compareSource(a: ShoppingNeedSource, b: ShoppingNeedSource): number {
  const byDate = compareIsoDate(a.date, b.date);
  if (byDate !== 0) return byDate;
  const byMealTag = MEAL_TAG_ORDER[a.slotType] - MEAL_TAG_ORDER[b.slotType];
  if (byMealTag !== 0) return byMealTag;
  const bySlotIndex = a.slotIndex - b.slotIndex;
  if (bySlotIndex !== 0) return bySlotIndex;
  return a.planSlotId.localeCompare(b.planSlotId);
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const existing = map.get(k);
    if (existing) {
      existing.push(item);
    } else {
      map.set(k, [item]);
    }
  }
  return map;
}

/**
 * Subtracts viable stock from needs, FIFO, and groups the remainder into
 * shopping-list lines with provenance.
 *
 * For each ingredient, needs are walked oldest-cook-date-first; each need
 * draws from viable lots (expiry on/after that need's cook date, per
 * `isOnOrAfter` — "a lot expiring Tuesday doesn't cover Friday's dinner"),
 * oldest lot first, until the need is met or viable stock runs out. Any
 * shortfall becomes that need's contribution to the ingredient's line; a
 * need fully covered by stock contributes nothing and is absent from
 * `sources`. An ingredient with no shortfall at all produces no line —
 * excess stock (more viable stock than total need) is simply left
 * unconsumed, never negative, never a line.
 */
export function allocateShoppingList(
  needs: readonly ShoppingNeed[],
  lots: readonly Lot[],
  range: DateRange,
): readonly ShoppingListLine[] {
  const needsByIngredient = groupBy(needs, (n) => n.ingredientId);
  const lotsByIngredient = groupBy(lots, (l) => l.ingredientId);

  const lines: ShoppingListLine[] = [];

  for (const [ingredientId, ingredientNeeds] of needsByIngredient) {
    const sortedNeeds = [...ingredientNeeds].sort(compareNeed);
    const sortedLots = [...(lotsByIngredient.get(ingredientId) ?? [])].sort(compareLotFifo);
    const lotRemaining = new Map<string, number>(sortedLots.map((l) => [l.id, l.quantity.amount]));

    let unit: Unit | undefined;
    let shortfallAmount = 0;
    const shortfallSources: ShoppingNeedSource[] = [];

    for (const need of sortedNeeds) {
      unit = need.quantity.unit;
      let remaining = need.quantity.amount;

      for (const lot of sortedLots) {
        if (remaining <= 0) break;
        if (!isOnOrAfter(lot.expiry, need.source.date)) continue; // not viable for this cook date
        const available = lotRemaining.get(lot.id) ?? 0;
        if (available <= 0) continue;
        const take = Math.min(remaining, available);
        lotRemaining.set(lot.id, available - take);
        remaining -= take;
      }

      if (remaining > 0) {
        shortfallAmount += remaining;
        shortfallSources.push(need.source);
      }
    }

    if (shortfallAmount > 0 && unit !== undefined) {
      lines.push({
        ingredientId,
        rangeStart: range.start,
        rangeEnd: range.end,
        neededQuantity: makeQuantity(shortfallAmount, unit),
        sources: shortfallSources.sort(compareSource),
      });
    }
  }

  return lines.sort((a, b) => a.ingredientId.localeCompare(b.ingredientId));
}
