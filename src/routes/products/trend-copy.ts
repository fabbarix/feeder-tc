/**
 * Human copy for a `PriceTrend` (price-history-aggregate.ts). Plain text and
 * a unicode glyph, not a Phosphor icon — this is the same "only exceptions
 * get colour" restraint UI_DESIGN.md §13 applies to the pantry's freshness
 * meter, extended here: a price going up or down is neither a warning nor a
 * success the way an expiring lot is, so the trend line stays the same
 * neutral text colour as everything around it and lets the words ("up"/
 * "down") carry the meaning instead of a red/green convention this app
 * doesn't use anywhere else.
 */
import { basisLabel, formatMoney } from "./currency-format.ts";
import type { PriceTrend } from "./price-history-aggregate.ts";

/** "▲"/"▼"/"–" glyph for a trend direction — decorative, always paired with the words below, never the sole carrier of meaning. */
export function trendGlyph(direction: "up" | "down" | "flat"): string {
  return direction === "up" ? "▲" : direction === "down" ? "▼" : "–";
}

/**
 * "$1.20 per 100 g" (no observations to compare — a single price, or the
 * latest of a longer series without the change line) / "▲ 4.2% since last
 * — $1.20 per 100 g" / "No change since last — $1.20 per 100 g" / "First
 * price recorded — $1.20 per 100 g" / "No prices recorded yet".
 */
export function trendSummary(trend: PriceTrend, currencySymbol: string): string {
  if (trend.kind === "none") return "No prices recorded yet";

  const latestText = `${formatMoney(trend.latest.amount, currencySymbol)} ${basisLabel(trend.latest.basis)}`;

  if (trend.kind === "single") return `First price recorded — ${latestText}`;

  if (trend.direction === "flat") return `No change since last — ${latestText}`;

  const pct = Math.abs(trend.deltaPct).toFixed(1);
  const word = trend.direction === "up" ? "up" : "down";
  return `${trendGlyph(trend.direction)} ${word} ${pct}% since last — ${latestText}`;
}

/** Compact form for a list row's trailing slot: "▲ 4.2%" / "No change" / "New" / "—". */
export function trendBadge(trend: PriceTrend): string {
  if (trend.kind === "none") return "—";
  if (trend.kind === "single") return "New";
  if (trend.direction === "flat") return "No change";
  const pct = Math.abs(trend.deltaPct).toFixed(1);
  return `${trendGlyph(trend.direction)} ${pct}%`;
}

/**
 * The change line ALONE, no price repeated (a detail page's header already
 * shows the price big, right above this) — "First price recorded" / "No
 * change since last" / "▲ up 4.2% since last" / "▼ down 4.2% since last".
 * Never called for `trend.kind === "none"` — the caller already gates the
 * whole head-trend block on "there is at least one observation".
 */
export function trendChangeOnly(trend: Exclude<PriceTrend, { readonly kind: "none" }>): string {
  if (trend.kind === "single") return "First price recorded";
  if (trend.direction === "flat") return "No change since last";
  const pct = Math.abs(trend.deltaPct).toFixed(1);
  const word = trend.direction === "up" ? "up" : "down";
  return `${trendGlyph(trend.direction)} ${word} ${pct}% since last`;
}
