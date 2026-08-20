/**
 * Non-converting Quantity helpers (design requirement 4).
 *
 * Deliberately does NOT include unit conversion or general arithmetic
 * (add/subtract) — that is FIFO/aggregation logic owned by WP-12
 * (inventory fold), WP-13 (planner scaling) and WP-14 (shopping
 * aggregation), each of which knows its own rounding/allocation rules. What
 * lives here is the one thing every one of those engines needs and must not
 * each reimplement slightly differently: the mixed-unit guard that makes
 * invariant 3 ("no conversion logic anywhere; reject mixed-unit writes")
 * enforceable at a single point.
 */
import type { Quantity } from "./types.ts";

export function sameUnit(a: Quantity, b: Quantity): boolean {
  return a.unit === b.unit;
}

/** Throws if `a` and `b` don't share a unit. Call before combining two quantities. */
export function assertSameUnit(a: Quantity, b: Quantity, context?: string): void {
  if (!sameUnit(a, b)) {
    const where = context ? ` (${context})` : "";
    throw new Error(`Mixed units: ${a.unit} vs ${b.unit}${where}`);
  }
}

export function isZero(q: Quantity): boolean {
  return q.amount === 0;
}

/** Human-readable display, e.g. `"400 g"` — for UI/warning text, not for parsing. */
export function formatQuantity(q: Quantity): string {
  return `${q.amount} ${q.unit}`;
}
