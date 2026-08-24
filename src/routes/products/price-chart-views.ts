/**
 * The products screen's three price-chart views (owner decision,
 * 2026-08-23 — DESIGN_PRODUCTS.md §9). Pure aggregation, no React, no I/O —
 * lives beside `price-history-aggregate.ts` (this route package's own
 * derived-view layer, not `src/domain/**`, which is frozen for this task).
 *
 * **Overall** pools every observation as one series — observation-weighted,
 * "what this household actually pays": a shop visited eight times pulls
 * the number toward itself eight times harder than a shop visited once.
 *
 * **By shop** draws one independently-toggleable series per shop that has
 * recorded observations, PLUS one series for observations that recorded no
 * shop at all (`shop: undefined` here — never dropped, never rendered as an
 * error; the caller labels it "Not noted", DESIGN_PRODUCTS.md §9).
 *
 * **Average across shops** takes the mean of the *per-shop* values —
 * shop-weighted: a shop visited once counts exactly as much as a shop
 * visited a hundred times. This is the "is this product dear or cheap,
 * independent of my shopping habits" number, and it is DELIBERATELY a
 * different number from Overall on the same data — see
 * `price-chart-views.test.ts` for the pinned example (a product bought
 * often cheaply at one shop and once dearly at another must show Average >
 * Overall, not the same figure twice). Unlabelled observations are
 * excluded here (they cannot be attributed to a shop, and including them
 * would silently re-weight the average toward wherever they happened) —
 * `excludedUnlabeledCount` is exactly why callers must say so on the chart
 * rather than let the two views quietly disagree unexplained.
 *
 * All three bucket by calendar month (`monthKey`) so the same product's
 * price history reads as a real over-time chart rather than one flat
 * number — but the month-bucketing is a display convenience, not the
 * point: the point being tested is that Overall and Average diverge on the
 * same underlying observations, which holds within a single month just as
 * well as across several (see the test file).
 */
import type { NormalizedPoint } from "./price-history-aggregate.ts";

/** `"2026-08-14T..."` -> `"2026-08"`. `IsoTimestamp` always starts with a full `YYYY-MM-DD`, so a plain slice is exact — no date-library needed for a calendar-month bucket key. */
export function monthKey(timestamp: string): string {
  return timestamp.slice(0, 7);
}

export interface ChartBucket {
  readonly monthKey: string;
  /** Mean normalised amount for this bucket, in this series' own weighting scheme (see each view's own doc comment above). */
  readonly amount: number;
  /** How many raw observations fed this bucket — shown as a tooltip/label, never used for further arithmetic by a caller. */
  readonly observationCount: number;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function groupByMonth(points: readonly NormalizedPoint[]): ReadonlyMap<string, readonly NormalizedPoint[]> {
  const byMonth = new Map<string, NormalizedPoint[]>();
  for (const point of points) {
    const key = monthKey(point.observation.timestamp);
    const existing = byMonth.get(key);
    if (existing) existing.push(point);
    else byMonth.set(key, [point]);
  }
  return byMonth;
}

function sortedMonthKeys(byMonth: ReadonlyMap<string, unknown>): readonly string[] {
  return [...byMonth.keys()].sort();
}

export interface OverallView {
  readonly buckets: readonly ChartBucket[];
}

/** Every observation pooled into one series, shop ignored entirely — including unlabelled ones (DESIGN_PRODUCTS.md §9: "the price was still paid"). */
export function overallView(points: readonly NormalizedPoint[]): OverallView {
  const byMonth = groupByMonth(points);
  const buckets = sortedMonthKeys(byMonth).map((key) => {
    const monthPoints = byMonth.get(key)!;
    return { monthKey: key, amount: mean(monthPoints.map((p) => p.amount)), observationCount: monthPoints.length };
  });
  return { buckets };
}

export interface ShopSeries {
  /** `undefined` = the "not noted" series (DESIGN_PRODUCTS.md §9) — a real, permanent bucket, never a migration artefact and never dropped. */
  readonly shop: string | undefined;
  readonly buckets: readonly ChartBucket[];
}

function groupByShop(points: readonly NormalizedPoint[]): ReadonlyMap<string | undefined, NormalizedPoint[]> {
  const byShop = new Map<string | undefined, NormalizedPoint[]>();
  for (const point of points) {
    const shop = point.observation.source;
    const existing = byShop.get(shop);
    if (existing) existing.push(point);
    else byShop.set(shop, [point]);
  }
  return byShop;
}

/**
 * One series per shop (each independently toggleable by the caller), plus
 * the `undefined`-keyed "not noted" series when at least one observation
 * has no `source`. Sorted with named shops alphabetical first, "not noted"
 * last — a real category, but not the one a reader scans for first.
 */
export function byShopView(points: readonly NormalizedPoint[]): readonly ShopSeries[] {
  const byShop = groupByShop(points);
  const shops = [...byShop.keys()].sort((a, b) => {
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return a.localeCompare(b);
  });
  return shops.map((shop) => {
    const shopPoints = byShop.get(shop)!;
    const byMonth = groupByMonth(shopPoints);
    const buckets = sortedMonthKeys(byMonth).map((key) => {
      const monthPoints = byMonth.get(key)!;
      return { monthKey: key, amount: mean(monthPoints.map((p) => p.amount)), observationCount: monthPoints.length };
    });
    return { shop, buckets };
  });
}

export interface AverageAcrossShopsView {
  readonly buckets: readonly ChartBucket[];
  /** How many observations were excluded for having no recorded shop — the caller must state this on the chart (DESIGN_PRODUCTS.md §9), never let it silently disagree with Overall. */
  readonly excludedUnlabeledCount: number;
}

/**
 * The mean of the PER-SHOP values, month by month: for each month, every
 * shop that has at least one (labelled) observation that month contributes
 * its own monthly average once, regardless of how many observations made
 * it up — a shop visited eight times counts exactly the same as a shop
 * visited once. This is what makes it diverge from `overallView` on the
 * same data (see this file's own header comment and the pinned test).
 * Unlabelled observations never enter this calculation at all.
 */
export function averageAcrossShopsView(points: readonly NormalizedPoint[]): AverageAcrossShopsView {
  const labelled = points.filter((p) => p.observation.source !== undefined);
  const excludedUnlabeledCount = points.length - labelled.length;

  // month -> shop -> that shop's amounts that month
  const byMonth = new Map<string, Map<string, number[]>>();
  for (const point of labelled) {
    const month = monthKey(point.observation.timestamp);
    const shop = point.observation.source!;
    let byShop = byMonth.get(month);
    if (!byShop) {
      byShop = new Map();
      byMonth.set(month, byShop);
    }
    const existing = byShop.get(shop);
    if (existing) existing.push(point.amount);
    else byShop.set(shop, [point.amount]);
  }

  const buckets = [...byMonth.keys()].sort().map((month) => {
    const byShop = byMonth.get(month)!;
    const shopAverages = [...byShop.values()].map((amounts) => mean(amounts));
    const observationCount = [...byShop.values()].reduce((sum, amounts) => sum + amounts.length, 0);
    return { monthKey: month, amount: mean(shopAverages), observationCount };
  });

  return { buckets, excludedUnlabeledCount };
}
