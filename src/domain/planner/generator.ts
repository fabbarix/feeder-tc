/**
 * The week generator, plus reroll/pin operations — WP-13.
 *
 * `generateWeek` implements DESIGN.md §2 "Planning" generator steps 1-2 for
 * one calendar week:
 *   1. Staples land first (via `advanceStaples`), one appearance each,
 *      round-robining across weeks when oversubscribed.
 *   2. Remaining slots draw randomly from in-rotation candidates
 *      (`candidatesForSlot`), weighted by `recipeWeight` (expiring-lot boost,
 *      ingredient-overlap boost) and excluding the N-week repeat window
 *      (`recentlyCookedRecipeIds`) and any recipe already placed elsewhere
 *      in the same week.
 *
 * `PlanSlot.pinned` slots (contracts.ts) are left completely untouched, and
 * — as a deliberate extension of that rule — so is any existing slot whose
 * `state` is no longer `"planned"` (i.e. already `"cooked"` or `"skipped"`):
 * regenerating a slot that has already happened would silently rewrite
 * history. Only unpinned, still-`"planned"` slots are candidates for
 * (re)filling.
 *
 * All randomness comes from the injected `Rng`, consumed in one fixed order
 * (staple placement first — pure, no draws — then random fill in
 * chronological slot order, then id minting for newly (re)filled slots in
 * that same order) so the whole result is reproducible under a seed.
 */
import { newPlanSlotId } from "../ids.ts";
import type { Rng } from "../contracts.ts";
import type {
  IngredientId,
  IsoDate,
  MealTag,
  PlanSlot,
  PlanSlotFilling,
  Recipe,
  RecipeId,
  RecipeIngredient,
  Settings,
} from "../types.ts";
import { candidatesForSlot, recentlyCookedRecipeIds } from "./candidates.ts";
import { expandWeekSlots } from "./slot-layout.ts";
import {
  advanceStaples,
  initialStapleRotationState,
  type StapleRotationState,
} from "./staples.ts";
import { recipeWeight, weightedPick } from "./weights.ts";

const ALL_MEAL_TAGS: readonly MealTag[] = ["breakfast", "lunch", "dinner", "snack"];
const EMPTY_INGREDIENT_SET: ReadonlySet<IngredientId> = new Set();

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

export interface GenerateWeekInput {
  readonly settings: Settings;
  /** First day of the 7-day window being generated. */
  readonly weekStart: IsoDate;
  readonly recipes: readonly Recipe[];
  readonly recipeIngredients: readonly RecipeIngredient[];
  /** Cooked history for the repeat-exclusion window — any slots dated before `weekStart` suffice. */
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
  readonly rng: Rng;
}

export interface GenerateWeekResult {
  readonly slots: readonly PlanSlot[];
  readonly staplePlanState: StaplePlanState;
}

export function generateWeek(input: GenerateWeekInput): GenerateWeekResult {
  const specs = expandWeekSlots(input.settings, input.weekStart);

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

  const fillings = new Array<PlanSlotFilling | undefined>(specs.length);

  const nextStaplePlanState: Record<MealTag, StapleRotationState> = {
    breakfast: input.staplePlanState?.breakfast ?? initialStapleRotationState,
    lunch: input.staplePlanState?.lunch ?? initialStapleRotationState,
    dinner: input.staplePlanState?.dinner ?? initialStapleRotationState,
    snack: input.staplePlanState?.snack ?? initialStapleRotationState,
  };

  // --- Step 1: staples, per meal tag, in chronological slot order. No Rng draws. ---
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
      fillings[slotIndex] = { kind: "recipe", recipeId };
      weekPlacedRecipeIds.add(recipeId);
      for (const id of ingredientIdsByRecipe.get(recipeId) ?? EMPTY_INGREDIENT_SET) {
        weekIngredientIds.add(id);
      }
    });
  }

  // --- Step 2: weighted random fill for everything still open, in chronological order. ---
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (spec === undefined) continue;
    if (preservedIndexes.has(i)) continue;
    const alreadyFilled = fillings[i];
    if (alreadyFilled !== undefined) continue;

    const pool = candidatesForSlot(input.recipes, spec.slotType, ["in-rotation"]).filter(
      (r) => !excludedRecentIds.has(r.id) && !weekPlacedRecipeIds.has(r.id),
    );

    if (pool.length === 0) {
      fillings[i] = { kind: "empty" };
      continue;
    }

    const weights = pool.map((r) =>
      recipeWeight({
        recipeIngredientIds: ingredientIdsByRecipe.get(r.id) ?? EMPTY_INGREDIENT_SET,
        expiringIngredientIds: input.expiringIngredientIds,
        weekIngredientIds,
      }),
    );
    const picked = weightedPick(pool, weights, input.rng);
    fillings[i] = { kind: "recipe", recipeId: picked.id };
    weekPlacedRecipeIds.add(picked.id);
    for (const id of ingredientIdsByRecipe.get(picked.id) ?? EMPTY_INGREDIENT_SET) {
      weekIngredientIds.add(id);
    }
  }

  // --- Assembly: preserved slots pass through verbatim; everything else gets its filling, id (reused if it existed), state "planned", pinned false. ---
  const slots: PlanSlot[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (spec === undefined) continue;
    const existing = existingBySpec.get(specKey(spec.date, spec.slotType, spec.slotIndex));

    if (preservedIndexes.has(i) && existing !== undefined) {
      slots.push(existing);
      continue;
    }

    const filling = fillings[i] ?? { kind: "empty" as const };
    const id = existing?.id ?? newPlanSlotId(input.rng);
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

  return { slots, staplePlanState: nextStaplePlanState };
}

// ---------------------------------------------------------------------------
// Single-slot reroll and pin/unpin — DESIGN.md §2 "Every slot has reroll and
// pin controls; manual placement always possible."
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
