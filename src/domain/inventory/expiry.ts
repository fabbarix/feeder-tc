/**
 * Pure expiry computation — WP-12.
 *
 * Single point where "when does this lot expire" is decided, so
 * purchase/move/open handling in `fold.ts` never reimplements the rule
 * slightly differently in three places. DESIGN.md §2 "Inventory
 * (event-sourced)":
 *
 * - Unopened, not frozen: `freshReferenceDate + ingredient.shelfLifeDays`.
 * - Opened, not frozen: `openedAt + ingredient.openedShelfLifeDays` — the
 *   opened countdown always starts from the day it was opened, not from
 *   purchase or any later move (see the "Opening shortens expiry" BDD
 *   scenario: shelf_life_days 7 / opened_shelf_life_days 2, purchased
 *   2026-03-01, opened 2026-03-02 → expiry 2026-03-04, i.e. openedAt + 2,
 *   with purchaseDate no longer in the calculation at all).
 * - Frozen (any location === "freezer"): expiry is suspended to a long,
 *   fixed horizon from the date it became frozen, regardless of opened
 *   state — freezing is a strong physical fact that overrides both the
 *   catalog countdown and the opened countdown while the lot stays frozen.
 *
 * The freezer branch deliberately does not need `ingredient` at all: the
 * suspension horizon is a fixed policy constant, not a catalog lookup, so
 * freezing a lot never fails even if the catalog is momentarily incomplete.
 */
import { addDays } from "../dates.ts";
import type { Ingredient, IsoDate, StorageLocation } from "../types.ts";

/**
 * ~6 months, DESIGN.md §2's "long fixed horizon, e.g. 6 months". Calibrated
 * (rather than a bare 180) so that freezing on the *last* day of a 31-day
 * month still lands on/after the same calendar day 6 months later — see the
 * "Freezing suspends expiry" BDD scenario (frozen 2026-03-03, expiry must be
 * at least 2026-09-03, which is exactly 184 days later).
 */
export const DEFAULT_FREEZER_SUSPENSION_DAYS = 186;

export interface ComputeExpiryInput {
  readonly location: StorageLocation;
  /** Set once a lot has been opened; unset (or omitted) for an unopened lot. */
  readonly openedAt?: IsoDate;
  /**
   * The date to count `ingredient.shelfLifeDays` (unopened branch) or the
   * freezer horizon from. Ignored when `openedAt` is set and the lot is not
   * frozen — the opened countdown only ever uses `openedAt`.
   */
  readonly freshReferenceDate: IsoDate;
  readonly freezerSuspensionDays: number;
  /**
   * Required unless `location === "freezer"`: the non-frozen branches need
   * `shelfLifeDays`/`openedShelfLifeDays` from the catalog.
   */
  readonly ingredient?: Ingredient;
}

/** Pure expiry rule described above. Throws only if a non-frozen computation is requested without the ingredient it needs. */
export function computeExpiry(input: ComputeExpiryInput): IsoDate {
  if (input.location === "freezer") {
    return addDays(input.freshReferenceDate, input.freezerSuspensionDays);
  }
  if (!input.ingredient) {
    throw new Error(
      'computeExpiry: "ingredient" is required to compute expiry when location is not "freezer"',
    );
  }
  if (input.openedAt !== undefined) {
    return addDays(input.openedAt, input.ingredient.openedShelfLifeDays);
  }
  return addDays(input.freshReferenceDate, input.ingredient.shelfLifeDays);
}
