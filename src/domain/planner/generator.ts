/**
 * The week generator, plus reroll/pin operations — WP-13, extended by
 * WP-leftover-planning for leftover-aware planning.
 *
 * `generateWeek` fills one calendar week's slots, per slot, in this priority
 * order (the work order's own wording):
 *
 *   1. An available REAL leftover lot (`GenerateWeekInput.leftoverLotsByRecipeId`
 *      — actual pantry stock from a meal already cooked), soonest-expiring
 *      first, never past its expiry for the candidate slot's date.
 *   2. A PROJECTED leftover — a meal already planned (this week, so far in
 *      this same generation, or in a prior week) that hasn't been cooked yet
 *      but is expected to yield surplus servings, honouring the same expiry
 *      rule plus `Settings.reuseGapSlots` (see `leftover-projection.ts`).
 *   3. A staple recipe (`advanceStaples`, cross-week round-robin — unchanged
 *      from before this work package).
 *   4. A weighted-random pick from in-rotation recipes not recently cooked
 *      and not already used elsewhere this week (`recipeWeight`/
 *      `weightedPick` — unchanged).
 *   5. A repeat: when nothing else can fill the slot, the eligible
 *      in-rotation recipe cooked longest ago (never a staple — see
 *      `pickLongestAgoRecipe`'s own doc comment for why) —
 *      "the no-repeat rule gives way rather than leaving a week unfilled",
 *      spreading repeats evenly rather than hammering one recipe (see
 *      `pickLongestAgoRecipe` below for exactly how "longest ago" is
 *      tracked across the week being generated, not just history).
 *
 * Leftovers (both kinds) are checked FIRST for every slot, in chronological
 * order, before staples/pool/fallback even run for that slot — "leftovers
 * are used first" (the work order) applies uniformly, including over a
 * staple's guaranteed placement: a staple whose turn falls on a slot a
 * leftover can fill simply doesn't get placed there (`StaplePlanState`
 * still advances as if it had a turn to give — see the staple-assignment
 * comment below for why that is deliberate). A newly-placed recipe
 * (staple, weighted pick, or repeat) that is itself expected to yield a
 * surplus (an indivisible/bought recipe rounding up, chiefly) becomes a new
 * projected-leftover candidate for any LATER slot within this same call —
 * this is how "Monday's cook feeding Wednesday's lunch" chains within one
 * `generateWeek` call.
 *
 * `PlanSlot.pinned` slots (contracts.ts) are left completely untouched, and
 * — as a deliberate extension of that rule — so is any existing slot whose
 * `state` is no longer `"planned"` (i.e. already `"cooked"` or `"skipped"`):
 * regenerating a slot that has already happened would silently rewrite
 * history. Only unpinned, still-`"planned"` slots are candidates for
 * (re)filling.
 *
 * All randomness comes from the injected `Rng`. Leftover/staple/repeat
 * decisions never draw from it (they are deterministic given the inputs);
 * only the weighted-random pool pick does, one draw per slot resolved that
 * way, in chronological order — so the whole result stays reproducible
 * under a seed exactly as before this work package (no existing seeded test
 * changes rng-consumption order, since a scenario with no leftover data
 * takes the same deterministic-no-op path through steps 1-2 it always
 * would have skipped).
 */
import { addDays, isOnOrAfter } from "../dates.ts";
import { newPlanSlotId } from "../ids.ts";
import type { Rng } from "../contracts.ts";
import type {
  IngredientId,
  IsoDate,
  Lot,
  LotId,
  MealTag,
  PlanSlot,
  PlanSlotFilling,
  PlanSlotId,
  Recipe,
  RecipeId,
  RecipeIngredient,
  Settings,
} from "../types.ts";
import { candidatesForSlot, recentlyCookedRecipeIds } from "./candidates.ts";
import {
  buildSlotSequence,
  effectiveReuseGapSlots,
  expectedSurplusServings,
  projectedLeftoverExpiry,
  reuseGapSatisfied,
  type SlotPosition,
  type SlotSequence,
} from "./leftover-projection.ts";
import { expandWeekSlots } from "./slot-layout.ts";
import {
  advanceStaples,
  initialStapleRotationState,
  type StapleRotationState,
} from "./staples.ts";
import { recipeWeight, weightedPick } from "./weights.ts";

const ALL_MEAL_TAGS: readonly MealTag[] = ["breakfast", "lunch", "dinner", "snack"];
const EMPTY_INGREDIENT_SET: ReadonlySet<IngredientId> = new Set();

/**
 * Fallback used only when a caller doesn't supply `leftoverShelfLifeDays`
 * (kept optional so every pre-existing `GenerateWeekInput` literal —
 * fixtures, other work packages' tests — still type-checks without it).
 * Matches `LEFTOVER_FRIDGE_SHELF_LIFE_DAYS` (`src/data/seed-catalog.ts`);
 * this module can't import that constant directly (domain/planner stays
 * decoupled from src/data, the same reasoning `leftovers.ts`'s own
 * `shelfLifeDays` parameter documents) so the value is duplicated here,
 * deliberately, rather than guessed differently. `usePlanWeek.ts` always
 * passes the real constant explicitly.
 */
const FALLBACK_LEFTOVER_SHELF_LIFE_DAYS = 4;

function buildIngredientIndex(
  lines: readonly RecipeIngredient[],
): Map<RecipeId, Set<IngredientId>> {
  const map = new Map<RecipeId, Set<IngredientId>>();
  for (const line of lines) {
    const set = map.get(line.recipeId) ?? new Set<IngredientId>();
    set.add(line.ingredientId);
    map.set(line.recipeId, set);
  }
  return map;
}

function specKey(date: IsoDate, slotType: MealTag, slotIndex: number): string {
  return `${date}|${slotType}|${slotIndex}`;
}

export type StaplePlanState = Readonly<Record<MealTag, StapleRotationState>>;

/** The state to pass in for a week that has never been generated before. */
export const initialStaplePlanState: StaplePlanState = {
  breakfast: initialStapleRotationState,
  lunch: initialStapleRotationState,
  dinner: initialStapleRotationState,
  snack: initialStapleRotationState,
};

// ---------------------------------------------------------------------------
// Leftover candidate bookkeeping (private to this module).
// ---------------------------------------------------------------------------

/** Where a projected leftover's source slot's id will come from once known. */
type SourceRef =
  | { readonly kind: "existing"; readonly id: PlanSlotId }
  | { readonly kind: "pending"; readonly specIndex: number };

interface ProjectedSource {
  readonly source: SourceRef;
  readonly position: SlotPosition;
  readonly recipeId: RecipeId;
  readonly expiry: IsoDate;
  /** Unique per source, used both to avoid double-claiming and for a stable pick order. */
  readonly claimKey: string;
}

/** A filling this module can build before every slot's final `PlanSlotId` is known (real ids are minted in assembly, in the original chronological order — see file header). */
type PendingFilling =
  | { readonly kind: "recipe"; readonly recipeId: RecipeId }
  | { readonly kind: "leftover"; readonly lotId: LotId }
  | { readonly kind: "leftover-projected"; readonly source: SourceRef; readonly recipeId: RecipeId }
  | { readonly kind: "empty" };

function resolvePendingFilling(pending: PendingFilling, ids: readonly PlanSlotId[]): PlanSlotFilling {
  switch (pending.kind) {
    case "recipe":
      return { kind: "recipe", recipeId: pending.recipeId };
    case "leftover":
      return { kind: "leftover", lotId: pending.lotId };
    case "leftover-projected": {
      const sourceSlotId = pending.source.kind === "existing" ? pending.source.id : ids[pending.source.specIndex];
      if (sourceSlotId === undefined) {
        throw new Error("generateWeek: unresolved leftover-projected source — unreachable");
      }
      return { kind: "leftover-projected", sourceSlotId, recipeId: pending.recipeId };
    }
    case "empty":
      return { kind: "empty" };
  }
}

/** Flattens `leftoverLotsByRecipeId` into one array, each entry remembering which recipe it came from (unused today but keeps the shape honest for future callers). */
function flattenRealLots(
  byRecipe: ReadonlyMap<RecipeId, readonly Lot[]> | undefined,
): readonly Lot[] {
  if (!byRecipe) return [];
  const all: Lot[] = [];
  for (const lots of byRecipe.values()) all.push(...lots);
  return all;
}

/** Picks the best still-available real leftover lot for `date`: soonest-expiring first, tie-broken by lot id for determinism. `undefined` if none qualify. */
function pickRealLeftover(
  lots: readonly Lot[],
  claimed: ReadonlySet<string>,
  date: IsoDate,
): Lot | undefined {
  let best: Lot | undefined;
  for (const lot of lots) {
    if (claimed.has(`lot:${lot.id}`)) continue;
    if (!isOnOrAfter(lot.expiry, date)) continue; // would already be past its use-by on this date
    if (
      !best ||
      lot.expiry < best.expiry ||
      (lot.expiry === best.expiry && lot.id < best.id)
    ) {
      best = lot;
    }
  }
  return best;
}

/** Picks the best still-available projected leftover for `targetPosition`: soonest-expiring first, tie-broken by claim key. `undefined` if none qualify (gap/expiry/claim all checked). */
function pickProjectedLeftover(
  sources: readonly ProjectedSource[],
  claimed: ReadonlySet<string>,
  seq: SlotSequence,
  targetPosition: SlotPosition,
  gapSlots: number,
): ProjectedSource | undefined {
  let best: ProjectedSource | undefined;
  for (const candidate of sources) {
    if (claimed.has(candidate.claimKey)) continue;
    if (!isOnOrAfter(candidate.expiry, targetPosition.date)) continue;
    if (!reuseGapSatisfied(seq, candidate.position, targetPosition, gapSlots)) continue;
    if (
      !best ||
      candidate.expiry < best.expiry ||
      (candidate.expiry === best.expiry && candidate.claimKey < best.claimKey)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Step 5's repeat pick: the in-rotation recipe for `mealTag` cooked longest
 * ago — "never" (absent from `lastUsedDate`) sorts before any real date.
 * Ties keep `candidatesForSlot`'s own (stable) order.
 *
 * Deliberately `["in-rotation"]` only, matching step 4's own candidate
 * status set, for two reasons:
 *
 *  - Staples have their OWN dedicated spread mechanism (the cross-week
 *    round-robin, `advanceStaples`/`StaplePlanState`) — "more staples than
 *    slots -> round-robin across weeks" (DESIGN.md), a deliberately SLOWER
 *    cadence than a plain repeat. A pure-staple week whose staples don't
 *    cover every slot (this generation's turn only takes what the queue has
 *    left) leaves the rest genuinely empty by design; letting this fallback
 *    repeat a staple early would collapse that spacing back into "every
 *    staple every week" and break the round-robin's own cross-week test.
 *  - The repeat-exclusion window (`excludedRecentIds`) still applies here
 *    FIRST — repeating a different, non-excluded in-rotation recipe is
 *    always preferred over breaking the exclusion window. Only when
 *    excluding recently-cooked recipes would leave NO in-rotation candidate
 *    at all for this meal tag does the window give way too — "the no-repeat
 *    rule gives way rather than leaving a week unfilled" is about not
 *    leaving a slot empty, not about preferring a repeat over honouring the
 *    window whenever a choice exists.
 */
function pickLongestAgoRecipe(
  recipes: readonly Recipe[],
  mealTag: MealTag,
  lastUsedDate: ReadonlyMap<RecipeId, IsoDate>,
  excludedRecentIds: ReadonlySet<RecipeId>,
): Recipe | undefined {
  const eligible = candidatesForSlot(recipes, mealTag, ["in-rotation"]);
  const respectingWindow = eligible.filter((r) => !excludedRecentIds.has(r.id));
  const pool = respectingWindow.length > 0 ? respectingWindow : eligible;
  let best: Recipe | undefined;
  let bestDate = "";
  for (const candidate of pool) {
    const date = lastUsedDate.get(candidate.id) ?? "";
    if (!best || date < bestDate) {
      best = candidate;
      bestDate = date;
    }
  }
  return best;
}

export interface GenerateWeekInput {
  readonly settings: Settings;
  /** First day of the 7-day window being generated. */
  readonly weekStart: IsoDate;
  readonly recipes: readonly Recipe[];
  readonly recipeIngredients: readonly RecipeIngredient[];
  /** Cooked/planned history for repeat-exclusion, leftover-projection chaining, and repeat-spread — any slots dated before `weekStart` suffice. */
  readonly pastPlanSlots: readonly PlanSlot[];
  /** Ingredient ids with a pantry lot expiring within the week being generated. */
  readonly expiringIngredientIds: ReadonlySet<IngredientId>;
  /** Cross-week staple rotation state — omit (or pass `initialStaplePlanState`) for the first-ever generation. */
  readonly staplePlanState?: StaplePlanState;
  /**
   * Slots already on the books for this exact week (e.g. regenerating after
   * pinning/rerolling some of them). Pinned slots, and any slot whose state
   * is no longer `"planned"`, are copied through untouched; everything else
   * is (re)filled from scratch. Omit for a first-time generation.
   */
  readonly existingSlots?: readonly PlanSlot[];
  /**
   * Currently-available real leftover lots, grouped by the recipe that
   * produced them. The domain layer has no `Ingredient` -> `Recipe` mapping
   * of its own (that slug convention lives in `src/routes/plan/
   * leftover-ingredient.ts`, a UI-layer concern) — the caller (`usePlanWeek.ts`)
   * does that lookup and passes the result in already recipe-keyed. Omit (or
   * pass an empty map) when there are none, or when the caller has no lots
   * loaded yet.
   */
  readonly leftoverLotsByRecipeId?: ReadonlyMap<RecipeId, readonly Lot[]>;
  /**
   * Leftover shelf life in days, used to project a not-yet-cooked meal's
   * leftover use-by date (`projectedLeftoverExpiry`) — the same value the
   * caller passes to `createLeftoverLot` at actual cook time
   * (`LEFTOVER_FRIDGE_SHELF_LIFE_DAYS`, `src/data/seed-catalog.ts`), kept an
   * explicit input rather than imported so this module stays decoupled from
   * `src/data` (see `leftovers.ts`'s own `shelfLifeDays` parameter for the
   * same reasoning). Optional only so pre-existing `GenerateWeekInput`
   * literals keep type-checking; see `FALLBACK_LEFTOVER_SHELF_LIFE_DAYS`.
   */
  readonly leftoverShelfLifeDays?: number;
  readonly rng: Rng;
}

export interface GenerateWeekResult {
  readonly slots: readonly PlanSlot[];
  readonly staplePlanState: StaplePlanState;
  /**
   * Slots this call actually placed something into (a recipe, a real
   * leftover, or a projected leftover) — never counts a preserved
   * (pinned/already-cooked) slot, since this call didn't touch those.
   * Added so a caller (usePlanWeek.ts) can tell the user what generation
   * actually did, rather than leaving a silent "some slots filled, most
   * didn't" result the way it used to (owner/UA-review finding: "Generate
   * week" gave no feedback at all). With repeats now filling almost every
   * week completely, this stays accurate rather than becoming a lie: it
   * only counts genuinely EMPTY slots below, and repeats/leftovers both
   * count as "filled".
   */
  readonly filledCount: number;
  /**
   * Slots this call left empty because absolutely nothing was eligible for
   * that meal tag: no real/projected leftover, no staple turn, and —
   * step 5's repeat fallback only ever comes up empty-handed here — no
   * IN-ROTATION recipe at all tagged for that meal (`pickLongestAgoRecipe`
   * deliberately never repeats a staple; see its own doc comment). A
   * pure-staple week whose staples don't cover every slot this generation
   * (the round-robin's own cadence, not a bug) is exactly this case too.
   */
  readonly emptyCount: number;
  /**
   * Meal tags that had at least one slot go unfilled for lack of any
   * in-rotation recipe tagged for that meal at all — the concrete "what
   * would let it fill more" the caller can name (tag a recipe for these
   * meals, or add more staples if the shortfall is a staple week).
   */
  readonly starvedMealTags: readonly MealTag[];
}

export function generateWeek(input: GenerateWeekInput): GenerateWeekResult {
  const specs = expandWeekSlots(input.settings, input.weekStart);
  const weekEnd = addDays(input.weekStart, 6);
  const reuseGapSlots = effectiveReuseGapSlots(input.settings);
  const shelfLifeDays = input.leftoverShelfLifeDays ?? FALLBACK_LEFTOVER_SHELF_LIFE_DAYS;
  const recipesById = new Map(input.recipes.map((r) => [r.id, r] as const));

  const existingBySpec = new Map<string, PlanSlot>();
  for (const slot of input.existingSlots ?? []) {
    existingBySpec.set(specKey(slot.date, slot.slotType, slot.slotIndex), slot);
  }

  const ingredientIdsByRecipe = buildIngredientIndex(input.recipeIngredients);
  const excludedRecentIds = recentlyCookedRecipeIds(
    input.pastPlanSlots,
    input.weekStart,
    input.settings.repeatExclusionWeeks,
  );

  // A slot is "preserved" (copied through untouched) if it's pinned, or if
  // it has already moved past "planned" (cooked/skipped) — see file header.
  const preservedIndexes = new Set<number>();
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (spec === undefined) continue;
    const existing = existingBySpec.get(specKey(spec.date, spec.slotType, spec.slotIndex));
    if (existing !== undefined && (existing.pinned || existing.state !== "planned")) {
      preservedIndexes.add(i);
    }
  }

  const weekIngredientIds = new Set<IngredientId>();
  const weekPlacedRecipeIds = new Set<RecipeId>();
  for (const i of preservedIndexes) {
    const spec = specs[i];
    if (spec === undefined) continue;
    const existing = existingBySpec.get(specKey(spec.date, spec.slotType, spec.slotIndex));
    if (existing !== undefined && existing.filling.kind === "recipe") {
      weekPlacedRecipeIds.add(existing.filling.recipeId);
      for (const id of ingredientIdsByRecipe.get(existing.filling.recipeId) ?? EMPTY_INGREDIENT_SET) {
        weekIngredientIds.add(id);
      }
    }
  }

  // --- Leftover bookkeeping: real lots, cross-week projected sources, and a
  // claim set covering everything already spoken for (history + preserved
  // slots this week) so this generation never double-books a lot or a
  // not-yet-cooked meal's surplus. ---
  const realLots = flattenRealLots(input.leftoverLotsByRecipeId);

  const claimed = new Set<string>();
  for (const slot of input.pastPlanSlots) {
    if (slot.filling.kind === "leftover") claimed.add(`lot:${slot.filling.lotId}`);
    else if (slot.filling.kind === "leftover-projected") claimed.add(`src:${slot.filling.sourceSlotId}`);
  }
  for (const i of preservedIndexes) {
    const spec = specs[i];
    if (spec === undefined) continue;
    const existing = existingBySpec.get(specKey(spec.date, spec.slotType, spec.slotIndex));
    if (existing === undefined) continue;
    if (existing.filling.kind === "leftover") claimed.add(`lot:${existing.filling.lotId}`);
    else if (existing.filling.kind === "leftover-projected") claimed.add(`src:${existing.filling.sourceSlotId}`);
  }

  // The slot sequence for gap counting needs to reach back far enough to
  // cover every past source that could still be viable by the time this
  // week starts — no farther, so the sequence doesn't grow unboundedly for
  // a workbook with years of history.
  let seqFrom = input.weekStart;
  const crossWeekSources: ProjectedSource[] = [];

  /**
   * Adds `slot` as a projected-leftover candidate if — and only if — it is
   * still `"planned"` (never a `"cooked"` slot, whose real surplus if any is
   * tracked separately via `leftoverLotsByRecipeId`, nor `"skipped"`, which
   * never happened at all) and its recipe is expected to yield a surplus
   * that hasn't already expired before this week starts. Shared by BOTH
   * `pastPlanSlots` (prior-week chaining) and this week's own PRESERVED
   * (pinned or already-non-"planned") `existingSlots` — a pinned Monday
   * dinner is exactly as valid a source for Wednesday as a prior week's
   * still-`"planned"` Sunday, and without this a pinned slot's leftover
   * would silently never be offered to anything.
   */
  function addPastOrPreservedSource(slot: PlanSlot): void {
    if (slot.filling.kind !== "recipe") return;
    if (slot.state !== "planned") return;
    if (claimed.has(`src:${slot.id}`)) return;
    const recipe = recipesById.get(slot.filling.recipeId);
    if (!recipe) return;
    const targetServings = slot.filling.scaleServings ?? input.settings.householdSize;
    const surplus = expectedSurplusServings(recipe, targetServings, input.settings.householdSize);
    if (surplus <= 0) return;
    const expiry = projectedLeftoverExpiry(slot.date, shelfLifeDays);
    if (!isOnOrAfter(expiry, input.weekStart)) return; // would already be past use-by before this week starts
    if (slot.date < seqFrom) seqFrom = slot.date;
    crossWeekSources.push({
      source: { kind: "existing", id: slot.id },
      position: { date: slot.date, slotIndex: slot.slotIndex },
      recipeId: slot.filling.recipeId,
      expiry,
      claimKey: `src:${slot.id}`,
    });
  }

  for (const slot of input.pastPlanSlots) addPastOrPreservedSource(slot);
  for (const i of preservedIndexes) {
    const spec = specs[i];
    if (spec === undefined) continue;
    const existing = existingBySpec.get(specKey(spec.date, spec.slotType, spec.slotIndex));
    if (existing !== undefined) addPastOrPreservedSource(existing);
  }

  const seq = buildSlotSequence(input.settings, seqFrom, weekEnd);

  // Recipes' most recent cook date, seeded from history and advanced as this
  // call places (or repeats) recipes — `pickLongestAgoRecipe`'s own input.
  const lastUsedDate = new Map<RecipeId, IsoDate>();
  for (const slot of input.pastPlanSlots) {
    if (slot.state !== "cooked" || slot.filling.kind !== "recipe") continue;
    const current = lastUsedDate.get(slot.filling.recipeId);
    if (!current || slot.date > current) lastUsedDate.set(slot.filling.recipeId, slot.date);
  }

  const withinWeekSources: ProjectedSource[] = [];

  // --- Staple assignment, precomputed per meal tag exactly as before this
  // work package: the round-robin state advances by "one turn per open
  // slot" regardless of whether a leftover ends up taking that slot instead
  // (see file header) — this keeps `StaplePlanState` behaviour unchanged
  // for every existing scenario with no leftover data. ---
  const stapleAssignmentByIndex = new Map<number, RecipeId>();
  const nextStaplePlanState: Record<MealTag, StapleRotationState> = {
    breakfast: input.staplePlanState?.breakfast ?? initialStapleRotationState,
    lunch: input.staplePlanState?.lunch ?? initialStapleRotationState,
    dinner: input.staplePlanState?.dinner ?? initialStapleRotationState,
    snack: input.staplePlanState?.snack ?? initialStapleRotationState,
  };
  for (const tag of ALL_MEAL_TAGS) {
    const openIndexesForTag: number[] = [];
    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i];
      if (spec === undefined) continue;
      if (spec.slotType === tag && !preservedIndexes.has(i)) {
        openIndexesForTag.push(i);
      }
    }
    const staples = candidatesForSlot(input.recipes, tag, ["staple"]);
    const stapleIds = staples.map((r) => r.id);
    const batch = advanceStaples(stapleIds, nextStaplePlanState[tag], openIndexesForTag.length);
    nextStaplePlanState[tag] = batch.nextState;
    batch.placed.forEach((recipeId, placedIndex) => {
      const slotIndex = openIndexesForTag[placedIndex];
      if (slotIndex === undefined) return;
      stapleAssignmentByIndex.set(slotIndex, recipeId);
    });
  }

  // --- Single chronological pass: for every open slot, leftover (real, then
  // projected) first, else its staple turn if it has one, else a weighted
  // pool pick, else the longest-ago repeat. ---
  const pendingFillings = new Array<PendingFilling | undefined>(specs.length);
  let filledCount = 0;
  let emptyCount = 0;
  const starvedMealTags = new Set<MealTag>();

  function registerPlacedRecipe(recipeId: RecipeId, specIndex: number, date: IsoDate): void {
    weekPlacedRecipeIds.add(recipeId);
    for (const id of ingredientIdsByRecipe.get(recipeId) ?? EMPTY_INGREDIENT_SET) weekIngredientIds.add(id);
    lastUsedDate.set(recipeId, date);
    const recipe = recipesById.get(recipeId);
    if (!recipe) return;
    const surplus = expectedSurplusServings(recipe, input.settings.householdSize, input.settings.householdSize);
    if (surplus <= 0) return;
    const spec = specs[specIndex];
    if (spec === undefined) return;
    withinWeekSources.push({
      source: { kind: "pending", specIndex },
      position: { date: spec.date, slotIndex: spec.slotIndex },
      recipeId,
      expiry: projectedLeftoverExpiry(date, shelfLifeDays),
      claimKey: `src-pending:${specIndex}`,
    });
  }

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (spec === undefined) continue;
    if (preservedIndexes.has(i)) continue;

    const targetPosition: SlotPosition = { date: spec.date, slotIndex: spec.slotIndex };

    const realLot = pickRealLeftover(realLots, claimed, spec.date);
    if (realLot) {
      pendingFillings[i] = { kind: "leftover", lotId: realLot.id };
      claimed.add(`lot:${realLot.id}`);
      filledCount += 1;
      continue;
    }

    const allProjectedSources = crossWeekSources.concat(withinWeekSources);
    const projected = pickProjectedLeftover(allProjectedSources, claimed, seq, targetPosition, reuseGapSlots);
    if (projected) {
      pendingFillings[i] = { kind: "leftover-projected", source: projected.source, recipeId: projected.recipeId };
      claimed.add(projected.claimKey);
      filledCount += 1;
      continue;
    }

    const stapleRecipeId = stapleAssignmentByIndex.get(i);
    if (stapleRecipeId !== undefined) {
      pendingFillings[i] = { kind: "recipe", recipeId: stapleRecipeId };
      filledCount += 1;
      registerPlacedRecipe(stapleRecipeId, i, spec.date);
      continue;
    }

    const pool = candidatesForSlot(input.recipes, spec.slotType, ["in-rotation"]).filter(
      (r) => !excludedRecentIds.has(r.id) && !weekPlacedRecipeIds.has(r.id),
    );
    if (pool.length > 0) {
      const weights = pool.map((r) =>
        recipeWeight({
          recipeIngredientIds: ingredientIdsByRecipe.get(r.id) ?? EMPTY_INGREDIENT_SET,
          expiringIngredientIds: input.expiringIngredientIds,
          weekIngredientIds,
        }),
      );
      const picked = weightedPick(pool, weights, input.rng);
      pendingFillings[i] = { kind: "recipe", recipeId: picked.id };
      filledCount += 1;
      registerPlacedRecipe(picked.id, i, spec.date);
      continue;
    }

    // Step 5: the no-repeat rule gives way rather than leaving the slot
    // empty — pick whichever eligible recipe was cooked longest ago (never
    // cooked sorts first). Only truly empty-handed when the tag has no
    // staple/in-rotation recipe tagged for it at all.
    const repeatPick = pickLongestAgoRecipe(input.recipes, spec.slotType, lastUsedDate, excludedRecentIds);
    if (repeatPick === undefined) {
      pendingFillings[i] = { kind: "empty" };
      emptyCount += 1;
      starvedMealTags.add(spec.slotType);
      continue;
    }
    pendingFillings[i] = { kind: "recipe", recipeId: repeatPick.id };
    filledCount += 1;
    registerPlacedRecipe(repeatPick.id, i, spec.date);
  }

  // --- Assembly: preserved slots pass through verbatim; everything else
  // gets an id (reused if it existed, minted in chronological order
  // otherwise — unchanged from before this work package), state "planned",
  // pinned false, and its filling resolved (a leftover-projected filling
  // whose source is one of THIS week's own newly-minted slots gets that id
  // only now that it's known). ---
  const ids = new Array<PlanSlotId>(specs.length);
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (spec === undefined) continue;
    const existing = existingBySpec.get(specKey(spec.date, spec.slotType, spec.slotIndex));
    ids[i] = existing?.id ?? newPlanSlotId(input.rng);
  }

  const slots: PlanSlot[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (spec === undefined) continue;
    const existing = existingBySpec.get(specKey(spec.date, spec.slotType, spec.slotIndex));

    if (preservedIndexes.has(i) && existing !== undefined) {
      slots.push(existing);
      continue;
    }

    const pending = pendingFillings[i] ?? { kind: "empty" as const };
    const filling = resolvePendingFilling(pending, ids);
    const id = ids[i];
    if (id === undefined) continue; // unreachable — ids is fully populated above
    slots.push({
      id,
      date: spec.date,
      slotType: spec.slotType,
      slotIndex: spec.slotIndex,
      filling,
      state: "planned",
      pinned: false,
    });
  }

  return {
    slots,
    staplePlanState: nextStaplePlanState,
    filledCount,
    emptyCount,
    starvedMealTags: [...starvedMealTags],
  };
}

// ---------------------------------------------------------------------------
// Single-slot reroll and pin/unpin — DESIGN.md §2 "Every slot has reroll and
// pin controls; manual placement always possible." Leftover-aware planning
// (real/projected) is `generateWeek`'s job only — a reroll always picks
// among ordinary in-rotation recipes, matching the UI (`PlanSlotRow.tsx`
// never offers Reroll on a leftover/leftover-projected slot).
// ---------------------------------------------------------------------------

export interface RerollSlotInput {
  readonly slot: PlanSlot;
  readonly settings: Settings;
  readonly weekStart: IsoDate;
  readonly recipes: readonly Recipe[];
  readonly recipeIngredients: readonly RecipeIngredient[];
  readonly pastPlanSlots: readonly PlanSlot[];
  /** Recipes already placed elsewhere in this slot's week. Must NOT include `slot`'s own current recipe. */
  readonly weekPlacedRecipeIds: ReadonlySet<RecipeId>;
  readonly weekIngredientIds: ReadonlySet<IngredientId>;
  readonly expiringIngredientIds: ReadonlySet<IngredientId>;
  readonly rng: Rng;
  /** Default `true`: exclude the slot's current recipe from the reroll pool when another candidate exists. */
  readonly excludeCurrentRecipe?: boolean;
}

/** Rerolls one unpinned slot's filling. Throws if `slot.pinned` — unpin it first. */
export function rerollSlot(input: RerollSlotInput): PlanSlot {
  if (input.slot.pinned) {
    throw new Error("rerollSlot: cannot reroll a pinned slot — unpin it first");
  }

  const excludeCurrent = input.excludeCurrentRecipe ?? true;
  const currentRecipeId =
    input.slot.filling.kind === "recipe" ? input.slot.filling.recipeId : undefined;

  const excludedRecentIds = recentlyCookedRecipeIds(
    input.pastPlanSlots,
    input.weekStart,
    input.settings.repeatExclusionWeeks,
  );
  const ingredientIdsByRecipe = buildIngredientIndex(input.recipeIngredients);

  let pool = candidatesForSlot(input.recipes, input.slot.slotType, ["in-rotation"]).filter(
    (r) => !excludedRecentIds.has(r.id) && !input.weekPlacedRecipeIds.has(r.id),
  );
  if (excludeCurrent && currentRecipeId !== undefined) {
    const withoutCurrent = pool.filter((r) => r.id !== currentRecipeId);
    if (withoutCurrent.length > 0) {
      pool = withoutCurrent;
    }
  }

  if (pool.length === 0) {
    return { ...input.slot, filling: { kind: "empty" } };
  }

  const weights = pool.map((r) =>
    recipeWeight({
      recipeIngredientIds: ingredientIdsByRecipe.get(r.id) ?? EMPTY_INGREDIENT_SET,
      expiringIngredientIds: input.expiringIngredientIds,
      weekIngredientIds: input.weekIngredientIds,
    }),
  );
  const picked = weightedPick(pool, weights, input.rng);
  return { ...input.slot, filling: { kind: "recipe", recipeId: picked.id } };
}

/** Pins or unpins a slot. A pinned slot is left untouched by `generateWeek` and cannot be `rerollSlot`ed. */
export function setSlotPinned(slot: PlanSlot, pinned: boolean): PlanSlot {
  return { ...slot, pinned };
}
