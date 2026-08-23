/**
 * Leftover candidate math for the generator — WP-leftover-planning.
 *
 * Three pure pieces the generator (`generator.ts`) composes per slot, kept
 * separate so each is independently unit-testable:
 *
 *  1. `expectedSurplusServings` — how many servings a recipe filling is
 *     expected to leave over, reusing `purchasing.ts`'s own
 *     `scaleIndivisible` for an indivisible recipe (a bought meal serving 6
 *     to a household of 4 always leaves 2, whole-unit rounding) rather than
 *     reimplementing that arithmetic (the work order's own instruction,
 *     applied here to the sibling "how much surplus" question alongside
 *     `leftovers.ts`'s "how does surplus become a lot" one).
 *  2. `buildSlotSequence` / `reuseGapSatisfied` — the reuse-gap arithmetic
 *     (`Settings.reuseGapSlots`, types.ts): counting MEAL SLOTS between a
 *     source and a candidate target, not days and not same-meal-type
 *     occurrences, per the owner's explicit decision.
 *  3. `projectedLeftoverExpiry` — a not-yet-cooked meal's leftover use-by
 *     date, via the exact same `addDays(cookDate, shelfLifeDays)` arithmetic
 *     `createLeftoverLot` (src/domain/inventory/leftovers.ts) uses to build
 *     a REAL lot's `expiryOverride`, so a projection can never promise a
 *     longer shelf life than cooking the same meal actually would.
 */
import { addDays, isOnOrAfter } from "../dates.ts";
import { isIndivisible, scaleIndivisible } from "../purchasing.ts";
import type { IsoDate, Recipe, Settings, Weekday } from "../types.ts";
import { isoDateWeekday, type WeekSlotSpec } from "./slot-layout.ts";

/** Absent `Settings.reuseGapSlots` means this (types.ts's own doc comment explains the choice). */
export const DEFAULT_REUSE_GAP_SLOTS = 2;

export function effectiveReuseGapSlots(settings: Settings): number {
  return Math.max(0, settings.reuseGapSlots ?? DEFAULT_REUSE_GAP_SLOTS);
}

/**
 * Expected surplus servings for a recipe filling scaled to `targetServings`,
 * for a household of `householdSize`. Matches `PlanSlotRow.tsx`'s own
 * `computeIndivisibleForecast` for an indivisible recipe (a bought meal, or
 * `indivisible: true`) — whole-unit rounding always produces the same
 * forecast whether it is being shown on the slot or used to plan a future
 * one. A divisible (ordinary cooked) recipe only produces a surplus when
 * `targetServings` was deliberately scaled above the household size (a
 * manual `scaleServings` override, or a `staple`/pool pick this generator
 * itself made scaled — which today it never does above `householdSize`, so
 * in practice only the override and indivisible-rounding paths ever yield a
 * positive number).
 */
export function expectedSurplusServings(
  recipe: Recipe,
  targetServings: number,
  householdSize: number,
): number {
  if (targetServings <= 0) return 0;
  if (isIndivisible(recipe)) {
    return scaleIndivisible(recipe, targetServings).surplusServings;
  }
  return Math.max(0, targetServings - householdSize);
}

/** A not-yet-cooked meal's leftover use-by date — see module header. */
export function projectedLeftoverExpiry(cookDate: IsoDate, shelfLifeDays: number): IsoDate {
  return addDays(cookDate, shelfLifeDays);
}

/** One (date, slotIndex) position in a strict chronological meal-slot ordering. */
export interface SlotPosition {
  readonly date: IsoDate;
  readonly slotIndex: number;
}

/**
 * A strict chronological ordering of every configured meal slot from
 * `fromDate` through `toDate` inclusive, used to count the reuse gap
 * (`Settings.reuseGapSlots`) between a source meal and a candidate leftover
 * slot — "counted in meal slots... regardless of slot type" (the work
 * order) means the ordering has to include every configured slot in that
 * span, not just the ones a particular candidate search happens to be
 * comparing. Deliberately does not reuse `expandWeekSlots` (that function
 * always walks exactly 7 days from its start) — a source and a target can
 * be any number of days apart, including across a week boundary.
 */
export interface SlotSequence {
  readonly specs: readonly WeekSlotSpec[];
  /** -1 if `date`/`slotIndex` isn't a configured slot in this sequence's range. */
  indexOf(date: IsoDate, slotIndex: number): number;
}

const MAX_SEQUENCE_DAYS = 400; // generous bound (well over a year) — a defensive guard against a caller-passed inverted/huge range, not a real limit.

export function buildSlotSequence(settings: Settings, fromDate: IsoDate, toDate: IsoDate): SlotSequence {
  const specs: WeekSlotSpec[] = [];
  const index = new Map<string, number>();
  let date = fromDate;
  let guard = 0;
  while (!isOnOrAfter(date, addDays(toDate, 1))) {
    if (guard >= MAX_SEQUENCE_DAYS) {
      throw new Error(`buildSlotSequence: range from ${fromDate} to ${toDate} exceeds ${MAX_SEQUENCE_DAYS} days`);
    }
    guard += 1;
    const weekday: Weekday = isoDateWeekday(date);
    const daySlots = settings.slotLayout.filter((l) => l.day === weekday).flatMap((l) => l.slots);
    daySlots.forEach((slotType, slotIndex) => {
      index.set(`${date}|${slotIndex}`, specs.length);
      specs.push({ date, slotType, slotIndex });
    });
    date = addDays(date, 1);
  }
  return {
    specs,
    indexOf: (d, si) => index.get(`${d}|${si}`) ?? -1,
  };
}

/**
 * True if at least `gapSlots` OTHER configured meal slots fall strictly
 * between `source` and `target` (both must resolve in `seq`, and `source`
 * must come before `target` — a candidate can never draw on a leftover from
 * later in the week). `gapSlots: 0` only requires `target` to be after
 * `source`, matching "at least two other slots" reading literally at zero.
 */
export function reuseGapSatisfied(
  seq: SlotSequence,
  source: SlotPosition,
  target: SlotPosition,
  gapSlots: number,
): boolean {
  const si = seq.indexOf(source.date, source.slotIndex);
  const ti = seq.indexOf(target.date, target.slotIndex);
  if (si < 0 || ti < 0) return false;
  if (ti <= si) return false;
  return ti - si - 1 >= gapSlots;
}
