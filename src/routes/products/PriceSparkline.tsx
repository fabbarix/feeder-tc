import styles from "./PriceSparkline.module.css";

export interface PriceSparklineProps {
  /** Normalised price amounts, oldest first — see `sparklineValues` (price-history-aggregate.ts). */
  readonly values: readonly number[];
  readonly width?: number;
  readonly height?: number;
  /** Accessible summary (e.g. "Price shape over 5 observations, rising") — the sparkline itself carries no per-point data a screen reader could usefully enumerate. */
  readonly label: string;
}

/**
 * Hand-rolled inline SVG sparkline (M6 — DESIGN_PRODUCTS.md §1.4's "so
 * fluctuations are visible over time"). No charting dependency: a price
 * series here is at most a dozen points (`sparklineValues`'s own cap), and
 * this is a ~25-line polyline — smaller than any library's runtime, and
 * themeable with `currentColor` the way the rest of the kit's icons already
 * are, rather than a library's own colour API. See this route's own report
 * for the bundle numbers that justify not reaching for one.
 *
 * Deliberately renders nothing below 2 points: a single observation has no
 * "shape" to draw (a one-point line is meaningless), and the caller already
 * has its own explicit "no trend yet" copy for that case
 * (`PriceTrend`'s `"single"` variant) — this must not draw a flat or
 * degenerate line that implies a trend where none is computable.
 */
export function PriceSparkline({ values, width = 96, height = 28, label }: PriceSparklineProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const padding = 3;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const lastIndex = values.length - 1;

  const points = values
    .map((value, index) => {
      const x = padding + (index / lastIndex) * usableWidth;
      // Flat series (span === 0): draw a level line through the middle
      // rather than dividing by zero — a real, if visually unexciting,
      // "no change" shape.
      const y = span === 0 ? padding + usableHeight / 2 : padding + usableHeight - ((value - min) / span) * usableHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className={styles.root}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
