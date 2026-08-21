/**
 * Pure derivation helpers for the Plan route (WP-22) — turning the raw
 * entities `usePlanWeek` loads (recipes, ingredients, lots, plan slots)
 * into what the screen renders, kept separate from that hook's I/O so this
 * logic is unit-testable without mounting React or a fake WorkbookStore.
 */
import { addDays, isOnOrAfter, makePlanSlotId, recentlyCookedRecipeIds, daysBetween } from "../../domain/index.ts";
import type {
  Ingredient,
  IngredientId,
  IsoDate,
  Lot,
  LotId,
  PlanSlot,
  Recipe,
  RecipeId,
  WeekSlotSpec,
} from "../../domain/index.ts";

function specKey(spec: Pick<WeekSlotSpec, "date" | "slotType" | "slotIndex">): string {
  return `${spec.date}|${spec.slotType}|${spec.slotIndex}`;
}

/**
 * Merges the week's configured slot positions (`expandWeekSlots`) with
 * whatever `PlanSlot` rows already exist in the workbook for that week. A
 * position with no row yet (nothing generated/picked there) gets a
 * placeholder — `filling: "empty"`, a deterministic id derived from its
 * position — so the UI can render "Pick a meal" for it before a week has
 * ever been generated, not just after (a fresh workbook has ZERO PlanSlot
 * rows: WP-13's generator only ever creates one when `generateWeek`/
 * `pickRecipe` actually runs). The deterministic id means picking a recipe
 * into a placeholder and persisting it, then later regenerating the week,
 * both resolve to the SAME row rather than orphaning a stray one.
 */
export function mergeWeekSlots(specs: readonly WeekSlotSpec[], existing: readonly PlanSlot[]): readonly PlanSlot[] {
  const bySpec = new Map<string, PlanSlot>();
  for (const slot of existing) bySpec.set(specKey(slot), slot);
  return specs.map((spec) => {
    const found = bySpec.get(specKey(spec));
    if (found) return found;
    return {
      id: makePlanSlotId(`virtual:${specKey(spec)}`),
      date: spec.date,
      slotType: spec.slotType,
      slotIndex: spec.slotIndex,
      filling: { kind: "empty" as const },
      state: "planned" as const,
      pinned: false,
    };
  });
}

export interface PlanSlotView {
  readonly slot: PlanSlot;
  readonly recipe: Recipe | undefined;
  readonly leftoverIngredient: Ingredient | undefined;
  readonly leftoverLot: Lot | undefined;
  readonly isToday: boolean;
}

export function buildSlotView(
  slot: PlanSlot,
  recipesById: ReadonlyMap<RecipeId, Recipe>,
  ingredientsById: ReadonlyMap<IngredientId, Ingredient>,
  lotsById: ReadonlyMap<LotId, Lot>,
  today: IsoDate,
): PlanSlotView {
  const recipe = slot.filling.kind === "recipe" ? recipesById.get(slot.filling.recipeId) : undefined;
  const leftoverLot = slot.filling.kind === "leftover" ? lotsById.get(slot.filling.lotId) : undefined;
  const leftoverIngredient = leftoverLot ? ingredientsById.get(leftoverLot.ingredientId) : undefined;
  return { slot, recipe, leftoverIngredient, leftoverLot, isToday: slot.date === today };
}

export interface PlanDay {
  readonly date: IsoDate;
  readonly slots: readonly PlanSlotView[];
}

/** Groups slots by date (already-expanded week dates) and orders each day's slots by `slotIndex`, matching how they'll appear on the day card/column. */
export function groupSlotsByDay(
  dates: readonly IsoDate[],
  slots: readonly PlanSlotView[],
): readonly PlanDay[] {
  return dates.map((date) => ({
    date,
    slots: slots
      .filter((view) => view.slot.date === date)
      .slice()
      .sort((a, b) => a.slot.slotIndex - b.slot.slotIndex),
  }));
}

export interface WeekSummary {
  readonly staplesPlaced: number;
  readonly emptySlots: number;
  readonly excluded: { readonly name: string; readonly weeksAgo: number } | undefined;
}

/**
 * The desktop subtitle line's data — "Household of 4 · 2 staples placed ·
 * 1 slot empty · Carbonara excluded (cooked 1 week ago)" (design/mock-
 * screens.html's Plan section). The excluded recipe shown is whichever
 * excluded-by-the-repeat-window recipe was cooked most recently, since
 * that's the one a user is most likely to wonder about.
 */
export function computeWeekSummary(
  weekSlots: readonly PlanSlot[],
  recipesById: ReadonlyMap<RecipeId, Recipe>,
  pastPlanSlots: readonly PlanSlot[],
  weekStart: IsoDate,
  repeatExclusionWeeks: number,
  today: IsoDate,
): WeekSummary {
  let staplesPlaced = 0;
  let emptySlots = 0;
  for (const slot of weekSlots) {
    if (slot.filling.kind === "empty") {
      emptySlots += 1;
    } else if (slot.filling.kind === "recipe") {
      if (recipesById.get(slot.filling.recipeId)?.status === "staple") staplesPlaced += 1;
    }
  }

  const excludedIds = recentlyCookedRecipeIds(pastPlanSlots, weekStart, repeatExclusionWeeks);
  let mostRecent: PlanSlot | undefined;
  for (const slot of pastPlanSlots) {
    if (slot.state !== "cooked" || slot.filling.kind !== "recipe") continue;
    if (!excludedIds.has(slot.filling.recipeId)) continue;
    if (!mostRecent || slot.date > mostRecent.date) mostRecent = slot;
  }
  const excludedRecipe =
    mostRecent && mostRecent.filling.kind === "recipe" ? recipesById.get(mostRecent.filling.recipeId) : undefined;

  const excluded =
    mostRecent && excludedRecipe
      ? { name: excludedRecipe.name, weeksAgo: Math.max(1, Math.round(daysBetween(mostRecent.date, today) / 7)) }
      : undefined;

  return { staplesPlaced, emptySlots, excluded };
}

/** Ingredient ids with a (non-freezer) pantry lot expiring within the 7-day window starting `weekStart` — WP-13's `GenerateWeekInput.expiringIngredientIds`. */
export function computeExpiringIngredientIds(
  lots: readonly Lot[],
  weekStart: IsoDate,
): ReadonlySet<IngredientId> {
  const weekEnd = addDays(weekStart, 6);
  const ids = new Set<IngredientId>();
  for (const lot of lots) {
    if (lot.location === "freezer") continue;
    if (isOnOrAfter(lot.expiry, weekStart) && isOnOrAfter(weekEnd, lot.expiry)) {
      ids.add(lot.ingredientId);
    }
  }
  return ids;
}
