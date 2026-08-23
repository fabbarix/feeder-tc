/** Public entry point for the planner engine (WP-13). See generator.ts for the main API. */
export { expandWeekSlots, isoDateWeekday, type WeekSlotSpec } from "./slot-layout.ts";
export { candidatesForSlot, recentlyCookedRecipeIds } from "./candidates.ts";
export {
  BASE_WEIGHT,
  OVERLAP_BOOST,
  EXPIRING_BOOST,
  recipeWeight,
  weightedPick,
  type RecipeWeightInput,
} from "./weights.ts";
export {
  advanceStaples,
  initialStapleRotationState,
  type StapleRotationState,
  type StapleBatch,
} from "./staples.ts";
export {
  servingsScaleFactor,
  scaleQuantity,
  resolveTargetServings,
  scaledRecipeIngredients,
  type ScaledIngredientLine,
} from "./scaling.ts";
export {
  generateWeek,
  rerollSlot,
  setSlotPinned,
  initialStaplePlanState,
  type GenerateWeekInput,
  type GenerateWeekResult,
  type StaplePlanState,
  type RerollSlotInput,
} from "./generator.ts";
export {
  DEFAULT_REUSE_GAP_SLOTS,
  effectiveReuseGapSlots,
  expectedSurplusServings,
  projectedLeftoverExpiry,
  buildSlotSequence,
  reuseGapSatisfied,
  conservativeSourcePosition,
  type SlotPosition,
  type SlotSequence,
} from "./leftover-projection.ts";
