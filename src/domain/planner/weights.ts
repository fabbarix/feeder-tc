/**
 * Weighted-random selection — WP-13.
 *
 * DESIGN.md §2 "Planning" (generator step 2) ranks the three signals: "strong
 * boost for recipes that consume pantry lots expiring that week" first,
 * "mild boost for ingredient overlap with meals already placed that week"
 * second, and a plain baseline otherwise. `recipeWeight` is a pure function
 * of that ranking; `EXPIRING_BOOST > OVERLAP_BOOST` (both added on top of
 * `BASE_WEIGHT`) is what `weights.test.ts` proves directly, per WP-13's
 * success criteria ("weights are pure functions with unit tests proving
 * ordering"). `weightedPick` is the roulette-wheel sampler the generator
 * runs those weights through, taking the injected `Rng` so the whole pick is
 * reproducible under a seed.
 */
import type { Rng } from "../contracts.ts";
import type { IngredientId } from "../types.ts";

/** Baseline weight every in-rotation candidate starts with. */
export const BASE_WEIGHT = 1;
/** Added when the candidate shares an ingredient with a meal already placed this week. */
export const OVERLAP_BOOST = 2;
/** Added when the candidate uses an ingredient with a lot expiring this week. Strictly bigger than `OVERLAP_BOOST`. */
export const EXPIRING_BOOST = 5;

export interface RecipeWeightInput {
  /** Ingredient ids used by the candidate recipe (from its RecipeIngredient rows). */
  readonly recipeIngredientIds: ReadonlySet<IngredientId>;
  /** Ingredient ids with a pantry lot expiring within the week being generated. */
  readonly expiringIngredientIds: ReadonlySet<IngredientId>;
  /** Ingredient ids used by recipes already placed elsewhere in this week's generation so far. */
  readonly weekIngredientIds: ReadonlySet<IngredientId>;
}

function intersects(a: ReadonlySet<IngredientId>, b: ReadonlySet<IngredientId>): boolean {
  // Iterate the smaller set for a cheap intersection test.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const id of small) {
    if (large.has(id)) return true;
  }
  return false;
}

/** Pure weight for one candidate recipe in one slot's selection round. Always > 0. */
export function recipeWeight(input: RecipeWeightInput): number {
  let weight: number = BASE_WEIGHT;
  if (intersects(input.recipeIngredientIds, input.weekIngredientIds)) {
    weight += OVERLAP_BOOST;
  }
  if (intersects(input.recipeIngredientIds, input.expiringIngredientIds)) {
    weight += EXPIRING_BOOST;
  }
  return weight;
}

/**
 * Roulette-wheel weighted pick: draws one `rng.next()` in [0, 1), scales it
 * by the total weight, and walks the cumulative weights to find the item it
 * lands on. Same seeded `Rng` sequence in ⇒ same pick out, every time.
 */
export function weightedPick<T>(items: readonly T[], weights: readonly number[], rng: Rng): T {
  if (items.length === 0 || items.length !== weights.length) {
    throw new Error("weightedPick: items and weights must be equal-length and non-empty");
  }
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) {
    throw new Error("weightedPick: total weight must be positive");
  }
  let remaining = rng.next() * total;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const weight = weights[i];
    if (item === undefined || weight === undefined) {
      // Unreachable given the length check above; satisfies noUncheckedIndexedAccess.
      continue;
    }
    remaining -= weight;
    if (remaining < 0) {
      return item;
    }
  }
  // Floating-point rounding fallback: land on the last item rather than throw.
  const last = items[items.length - 1];
  if (last === undefined) {
    throw new Error("weightedPick: unreachable — items.length was checked non-zero above");
  }
  return last;
}
