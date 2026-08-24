import { useId } from "react";
import type { ChartBucket } from "./price-chart-views.ts";
import { formatMonthKeyShort } from "../date-format.ts";
import styles from "./products.module.css";

export interface ChartSeriesInput {
  readonly key: string;
  readonly label: string;
  /** A `--series-N` CSS custom property, or `undefined` for the "not noted" series, which always renders in a fixed muted/dashed style so it never competes visually with a real shop's colour (DESIGN_PRODUCTS.md §9). */
  readonly color: string | undefined;
  readonly buckets: readonly ChartBucket[];
}

export interface ProductPriceChartProps {
  readonly series: readonly ChartSeriesInput[];
  /** Series keys currently hidden — toggled by the legend buttons this component renders itself, so a caller only needs to own the `Set` and pass a setter. */
  readonly hiddenKeys: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly currencySymbol: string;
  readonly basisLabel: string;
  /** Shows toggle buttons in the legend — off for "Overall"/"Average", which are always exactly one series and have nothing to toggle. */
  readonly toggleable?: boolean;
  readonly height?: number;
}

const WIDTH = 600;
const PADDING_X = 28;
const PADDING_Y = 16;

/**
 * Hand-rolled inline SVG (no charting library — CSP forbids external
 * assets, same reasoning as `PriceSparkline.tsx`). Scales via `viewBox` +
 * `width: 100%` (see products.module.css), so this reads at 390px just as
 * well as 1512px — a fixed-pixel chart that only makes sense on desktop is
 * exactly what the task brief calls "half-built".
 *
 * Renders a dot for every point (unlike `PriceSparkline`, which refuses
 * below 2 points) because a single, low-volume shop is a real and common
 * case here, not a degenerate one — DESIGN_PRODUCTS.md §9's own "thin at
 * first" framing. A line only connects a series with 2+ points.
 */
export function ProductPriceChart({
  series,
  hiddenKeys,
  onToggle,
  currencySymbol,
  basisLabel,
  toggleable = true,
  height = 200,
}: ProductPriceChartProps) {
  const titleId = useId();
  const visible = series.filter((s) => !hiddenKeys.has(s.key) && s.buckets.length > 0);

  const allMonths = [...new Set(visible.flatMap((s) => s.buckets.map((b) => b.monthKey)))].sort();
  const allAmounts = visible.flatMap((s) => s.buckets.map((b) => b.amount));

  if (allMonths.length === 0) {
    return (
      <div className={styles.chartEmpty}>
        <p>Not enough recorded prices yet to draw a chart here.</p>
      </div>
    );
  }

  const min = Math.min(...allAmounts);
  const max = Math.max(...allAmounts);
  const span = max - min;

  function xFor(monthKey: string): number {
    if (allMonths.length === 1) return WIDTH / 2;
    const index = allMonths.indexOf(monthKey);
    return PADDING_X + (index / (allMonths.length - 1)) * (WIDTH - PADDING_X * 2);
  }

  function yFor(amount: number): number {
    if (span === 0) return height / 2;
    return PADDING_Y + (height - PADDING_Y * 2) * (1 - (amount - min) / span);
  }

  // Sample at most 6 tick labels, evenly, so 390px stays legible even with
  // a year of monthly buckets (a real, if optimistic, amount of history).
  const tickStep = Math.max(1, Math.ceil(allMonths.length / 6));
  const ticks = allMonths.filter((_, i) => i % tickStep === 0 || i === allMonths.length - 1);

  return (
    <div className={styles.chartWrap}>
      <svg
        className={styles.chartSvg}
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-labelledby={titleId}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>
          {`Price chart, ${basisLabel}, ${visible.length} series, ${allMonths.length} month${allMonths.length === 1 ? "" : "s"} of data`}
        </title>
        {/* A light baseline grid line at the min and max makes the shape
            readable without a full axis — kept minimal per UI_DESIGN.md's
            "only exceptions get colour/decoration" spirit. */}
        <line x1={PADDING_X} y1={height - PADDING_Y} x2={WIDTH - PADDING_X} y2={height - PADDING_Y} className={styles.chartAxis} />
        {ticks.map((month) => (
          <text key={month} x={xFor(month)} y={height - 2} className={styles.chartTick} textAnchor="middle">
            {formatMonthKeyShort(month)}
          </text>
        ))}
        {visible.map((s) => {
          const sorted = [...s.buckets].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
          const points = sorted.map((b) => `${xFor(b.monthKey).toFixed(1)},${yFor(b.amount).toFixed(1)}`);
          const isUnlabeled = s.color === undefined;
          const strokeStyle = isUnlabeled ? "var(--text-muted)" : `var(--${s.color})`;
          return (
            <g key={s.key}>
              {points.length >= 2 ? (
                <polyline
                  points={points.join(" ")}
                  fill="none"
                  stroke={strokeStyle}
                  strokeWidth={2}
                  strokeDasharray={isUnlabeled ? "5 4" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {sorted.map((b) => (
                <circle key={b.monthKey} cx={xFor(b.monthKey)} cy={yFor(b.amount)} r={3.5} fill={strokeStyle} />
              ))}
            </g>
          );
        })}
      </svg>

      <ul className={styles.chartLegend}>
        {series.map((s) => {
          const isHidden = hiddenKeys.has(s.key);
          const isUnlabeled = s.color === undefined;
          const swatchStyle = isUnlabeled ? undefined : { background: `var(--${s.color})` };
          const content = (
            <>
              <span
                className={`${styles.chartSwatch}${isUnlabeled ? ` ${styles.chartSwatchMuted}` : ""}`}
                style={swatchStyle}
                aria-hidden="true"
              />
              <span className={isHidden ? styles.chartLegendLabelHidden : undefined}>{s.label}</span>
            </>
          );
          return (
            <li key={s.key}>
              {toggleable ? (
                <button
                  type="button"
                  className={styles.chartLegendButton}
                  aria-pressed={!isHidden}
                  onClick={() => onToggle(s.key)}
                >
                  {content}
                </button>
              ) : (
                <span className={styles.chartLegendButton}>{content}</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className={styles.chartCaption}>
        {currencySymbol} {basisLabel}
      </p>
    </div>
  );
}
