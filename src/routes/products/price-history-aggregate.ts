/**
 * Pure aggregation for the price-history view (M6 — DESIGN_PRODUCTS.md §1.4:
 * "Price history is kept at two levels — per category/ingredient and per
 * specific product — so fluctuations are visible over time"). Lives under
 * this route package, not `src/domain/**` (which is FROZEN for M6 — see this
 * package's own task brief): same reasoning as `pantry-aggregate.ts` living
 * under `src/routes/pantry/**`, this is "a container's own derived view
 * logic" built ON TOP of the frozen domain layer, not a new domain engine.
 *
 * Every `PriceObservation` for one ingredient shares that ingredient's one
 * canonical `Unit` (invariant 3 — `Product.canonicalQuantity` and a bare
 * ingredient-level observation's `quantity` are both always in that same
 * unit), so `normalizePrice` (src/domain/price-normalization.ts) never mixes
 * bases within one ingredient's series — no unit-conversion logic needed
 * here, only grouping, sorting and simple percentage arithmetic.
 *
 * "Ingredient level" = every observation for that `ingredientId`, whether or
 * not it names a specific `barcode` — the coarse, blended series. "Product
 * level" = only the observations naming one specific `barcode` — a finer
 * lens on the same ingredient's data. This reading of §1.4's "two levels"
 * needs no schema beyond what M6-A already shipped: `PriceObservation`
 * already carries an optional `barcode` for exactly this distinction.
 */
import { normalizePrice, type NormalizedPriceBasis } from "../../domain/price-normalization.ts";
import type {
  Barcode,
  Ingredient,
  IngredientId,
  PriceObservation,
  Product,
} from "../../domain/index.ts";

export interface NormalizedPoint {
  readonly observation: PriceObservation;
  readonly basis: NormalizedPriceBasis;
  /** Normalised amount, in the household's single currency (Settings.currency), per `basis`. */
  readonly amount: number;
}

/**
 * `"none"` (zero observations) and `"single"` (exactly one — no prior point
 * to compare against, so no trend is computable) are distinct from
 * `"trend"` on purpose: a caller must not divide by a non-existent previous
 * point, and the UI shows a different, explicit message for each rather than
 * treating "one observation" as a degenerate two-point trend.
 */
export type PriceTrend =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly latest: NormalizedPoint }
  | {
      readonly kind: "trend";
      readonly latest: NormalizedPoint;
      readonly previous: NormalizedPoint;
      /** Signed percentage change, latest vs. the immediately preceding observation (not vs. the first ever seen — a ticker-style "since last time", the reading most relevant to "is this still a good price"). */
      readonly deltaPct: number;
      readonly direction: "up" | "down" | "flat";
    };

/** Below this absolute percentage, a change reads as noise rather than a real fluctuation — shown as "flat" rather than a misleadingly precise tiny arrow. */
const FLAT_THRESHOLD_PCT = 0.5;

/**
 * Normalises and time-sorts (oldest first) a set of observations.
 * `normalizePrice` throws on a non-positive quantity/price (a malformed row
 * that should have been quarantined by the codec already) — skipped here
 * defensively rather than letting one bad row take the whole view down,
 * matching `DecodeResult`'s own "skip and warn, never throw" discipline one
 * layer up.
 */
export function normalizedPointsFor(observations: readonly PriceObservation[]): readonly NormalizedPoint[] {
  const points: NormalizedPoint[] = [];
  for (const observation of observations) {
    try {
      const { basis, amount } = normalizePrice(observation);
      points.push({ observation, basis, amount });
    } catch {
      // Malformed row (non-positive price/quantity) — silently excluded,
      // same "skip, don't crash the view" discipline as a codec warning.
    }
  }
  return points
    .slice()
    .sort((a, b) =>
      a.observation.timestamp < b.observation.timestamp
        ? -1
        : a.observation.timestamp > b.observation.timestamp
          ? 1
          : 0,
    );
}

/** Builds the trend from a time-sorted (oldest-first) points array — see `PriceTrend`'s doc comment for why 0/1/2+ points are three distinct shapes. */
export function buildTrend(points: readonly NormalizedPoint[]): PriceTrend {
  if (points.length === 0) return { kind: "none" };
  const latest = points[points.length - 1]!;
  if (points.length === 1) return { kind: "single", latest };

  const previous = points[points.length - 2]!;
  const deltaPct = previous.amount === 0 ? 0 : ((latest.amount - previous.amount) / previous.amount) * 100;
  const direction: "up" | "down" | "flat" =
    Math.abs(deltaPct) < FLAT_THRESHOLD_PCT ? "flat" : deltaPct > 0 ? "up" : "down";
  return { kind: "trend", latest, previous, deltaPct, direction };
}

export interface IngredientPriceSummary {
  readonly ingredient: Ingredient;
  /** Every observation for this ingredient, own or via any of its products — oldest first. */
  readonly points: readonly NormalizedPoint[];
  readonly trend: PriceTrend;
}

/** One summary per ingredient that has at least one (normalizable) price observation — an ingredient with none is simply absent, same "no row for empty data" convention as `pantry-aggregate.ts`. Sorted by ingredient name for a stable list. */
export function aggregateByIngredient(
  observations: readonly PriceObservation[],
  ingredientsById: ReadonlyMap<IngredientId, Ingredient>,
): readonly IngredientPriceSummary[] {
  const byIngredient = new Map<IngredientId, PriceObservation[]>();
  for (const observation of observations) {
    const existing = byIngredient.get(observation.ingredientId);
    if (existing) existing.push(observation);
    else byIngredient.set(observation.ingredientId, [observation]);
  }

  const summaries: IngredientPriceSummary[] = [];
  for (const [ingredientId, ingredientObservations] of byIngredient) {
    const ingredient = ingredientsById.get(ingredientId);
    if (!ingredient) continue; // Same "skip rows with no matching catalog entry" discipline as pantry-aggregate.ts.
    const points = normalizedPointsFor(ingredientObservations);
    if (points.length === 0) continue;
    summaries.push({ ingredient, points, trend: buildTrend(points) });
  }
  return summaries.sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
}

export interface ProductPriceSummary {
  readonly product: Product;
  /**
   * WP-PRODUCTS-MODEL: the barcode this summary was grouped by — a `Product`
   * no longer carries its own barcode(s) (it may own several), so callers
   * building a per-product URL or photo key need this explicitly rather than
   * reading `product.barcode` (which no longer exists). Grouping stays
   * per-barcode, not per-`ProductId`, deliberately: DESIGN_PRODUCTS.md's
   * "price charts split by shop" is the follow-up UI task this package's
   * brief explicitly defers — see this file's own header comment. A merged
   * product's several barcodes therefore still produce separate summaries
   * here; nothing is lost (every observation is still present, just not yet
   * combined into one line), which is exactly the non-destructive behaviour
   * the brief asks for pending that follow-up.
   */
  readonly barcode: Barcode;
  readonly ingredient: Ingredient | undefined;
  /** Only observations naming THIS barcode — oldest first. */
  readonly points: readonly NormalizedPoint[];
  readonly trend: PriceTrend;
}

/** One summary per product barcode that has at least one price observation naming it. Sorted by product name. */
export function aggregateByProduct(
  observations: readonly PriceObservation[],
  productsByBarcode: ReadonlyMap<Barcode, Product>,
  ingredientsById: ReadonlyMap<IngredientId, Ingredient>,
): readonly ProductPriceSummary[] {
  const byBarcode = new Map<Barcode, PriceObservation[]>();
  for (const observation of observations) {
    if (observation.barcode === undefined) continue;
    const existing = byBarcode.get(observation.barcode);
    if (existing) existing.push(observation);
    else byBarcode.set(observation.barcode, [observation]);
  }

  const summaries: ProductPriceSummary[] = [];
  for (const [barcode, productObservations] of byBarcode) {
    const product = productsByBarcode.get(barcode);
    if (!product) continue; // Barcode referenced by an observation but no longer in the Products sheet — skip, don't crash.
    const points = normalizedPointsFor(productObservations);
    if (points.length === 0) continue;
    summaries.push({
      product,
      barcode,
      ingredient: ingredientsById.get(product.ingredientId),
      points,
      trend: buildTrend(points),
    });
  }
  return summaries.sort((a, b) => a.product.name.localeCompare(b.product.name));
}

/** The product-level summaries for one specific ingredient — the ingredient detail page's "By product" breakdown. */
export function productSummariesForIngredient(
  productSummaries: readonly ProductPriceSummary[],
  ingredientId: IngredientId,
): readonly ProductPriceSummary[] {
  return productSummaries.filter((summary) => summary.product.ingredientId === ingredientId);
}

/** Up to `max` normalised amounts, oldest first, for the sparkline — the shape of recent history, not the full series (a year of weekly scans would otherwise cram an unreadable number of segments into ~90px). */
export function sparklineValues(points: readonly NormalizedPoint[], max = 12): readonly number[] {
  return points.slice(-max).map((p) => p.amount);
}
