/** Shared expiry badge text/tone for the pantry list and pantry-item routes (WP-VC4) — one formatting rule so the aggregated row's badge and a lot's own badge never disagree about what "soon" means. */
import { formatMonthYear, formatShortDate } from "../date-format.ts";
import type { IsoDate } from "../../domain/index.ts";

export type ExpiryTone = "ok" | "warn" | "crit";

export interface ExpiryBadge {
  readonly label: string;
  readonly tone: ExpiryTone;
}

/** Same day-thresholds `PantryLotRow.tsx` already uses for its own expiry text colour — kept in sync deliberately, not just coincidentally similar. */
export function expiryTone(daysLeft: number): ExpiryTone {
  if (daysLeft < 0) return "crit";
  if (daysLeft <= 3) return "warn";
  return "ok";
}

/**
 * "Expired" / "2 days" / "Expires 28 Aug" / "Expires Aug 2028" — relative
 * for anything imminent (where a day count is the useful number), absolute
 * once it's far enough out that "in 214 days" stops being legible, matching
 * the mix the mock itself shows across its pantry rows.
 */
export function expiryBadge(daysLeft: number, expiry: IsoDate): ExpiryBadge {
  const tone = expiryTone(daysLeft);
  if (daysLeft < 0) return { label: "Expired", tone };
  if (daysLeft <= 13) return { label: `${daysLeft} day${daysLeft === 1 ? "" : "s"}`, tone };
  if (daysLeft <= 60) return { label: `Expires ${formatShortDate(expiry)}`, tone };
  return { label: `Expires ${formatMonthYear(expiry)}`, tone };
}
