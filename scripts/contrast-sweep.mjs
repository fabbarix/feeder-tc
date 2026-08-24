#!/usr/bin/env node
// Numeric contrast sweep (WP-tokens enforcement #5, token-layer proposal
// `#enforce`) — the OKLCH→sRGB relative-luminance math that caught the
// hue-189 and hue-156 failures documented in src/index.css (WP-15b) is a
// standalone Node script instead of a one-off browser check, so it runs on
// every PR that touches src/index.css, not just the day someone remembers
// to look. No DOM, no Playwright — pure math, matching the L/C constants
// declared in src/index.css exactly. If those constants drift, this script
// and the CSS will disagree and the sweep is what should be trusted.
//
// Run: node scripts/contrast-sweep.mjs (wired into `npm run lint`).

/** @param {number} l @param {number} a @param {number} b */
function oklabToLinearSrgb(l, a, b) {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

function linearToSrgb(c) {
  const cl = Math.max(0, Math.min(1, c));
  return cl <= 0.0031308 ? 12.92 * cl : 1.055 * cl ** (1 / 2.4) - 0.055;
}

/** oklch(l c h) -> [r,g,b] 0..255 */
function oklchToRgb(l, c, hDeg) {
  const hRad = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  const [r, g, bl] = oklabToLinearSrgb(l, a, b);
  return [r, g, bl].map((x) => Math.round(Math.max(0, Math.min(1, linearToSrgb(x))) * 255));
}

function relLuminance([r, g, b]) {
  const f = (c) => {
    const cs = c / 255;
    return cs <= 0.04045 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(rgb1, rgb2) {
  const l1 = relLuminance(rgb1);
  const l2 = relLuminance(rgb2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// Fixed backgrounds (hue-independent — paper/surface are tied to
// --accent-hue too, but at chroma so low it barely moves; using the default
// hue 156 here is representative, matching the sweep methodology already
// documented in index.css's own WP-15b comments).
const PAPER_LIGHT = oklchToRgb(0.985, 0.006, 156);
const SURFACE_LIGHT = oklchToRgb(1, 0, 0);
const PAPER_DARK = oklchToRgb(0.17, 0.012, 156);
const SURFACE_DARK = oklchToRgb(0.215, 0.014, 156);

// [label, fillL, fillC, textL, textC, textA(0 means achromatic offset from
// fill hue — accent-text light is pure white, chroma 0), background, minRatio]
const AA = 4.5;
const AAA = 7;

let failures = [];

function sweepPair(label, fillL, fillC, textL, textC, bg, minRatio) {
  let worst = Infinity;
  let worstHue = 0;
  for (let h = 0; h < 360; h++) {
    const fill = oklchToRgb(fillL, fillC, h);
    const text = oklchToRgb(textL, textC, h);
    const r = contrast(text, fill);
    if (r < worst) {
      worst = r;
      worstHue = h;
    }
  }
  const ok = worst >= minRatio;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: worst ${worst.toFixed(2)}:1 at hue ${worstHue} (need ${minRatio}:1)`,
  );
  if (!ok) failures.push(label);
  void bg;
}

console.log("=== Contrast sweep (360 hues, matches src/index.css L/C constants) ===\n");

// Accent fill vs accent-text — light: text is pure white (chroma 0).
sweepPair("light accent-text on accent", 0.45, 0.18, 1, 0, null, AA);
// Dark: text derived at the same hue, low chroma.
sweepPair("dark accent-text on accent", 0.76, 0.13, 0.18, 0.02, null, AA);

// Semantic fills as TEXT against paper/surface (--warn/--crit/--success used
// as foreground colour, e.g. hstatWarn .n, badge text) — fixed hue, so the
// "sweep" is really one point per family, run through the same harness for
// consistency and to catch a future author accidentally parameterising the
// hue.
function checkFixed(label, l, c, h, bg, minRatio) {
  const rgb = oklchToRgb(l, c, h);
  const r = contrast(rgb, bg);
  const ok = r >= minRatio;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${r.toFixed(2)}:1 (need ${minRatio}:1)`);
  if (!ok) failures.push(label);
}

checkFixed("light --warn on --paper", 0.45, 0.18, 72, PAPER_LIGHT, AA);
checkFixed("light --crit on --paper", 0.45, 0.2, 27, PAPER_LIGHT, AA);
checkFixed("light --success on --paper", 0.45, 0.16, 152, PAPER_LIGHT, AA);
checkFixed("light --success on --surface", 0.45, 0.16, 152, SURFACE_LIGHT, AA);
checkFixed("dark --warn on --paper", 0.8, 0.16, 72, PAPER_DARK, AA);
checkFixed("dark --crit on --paper", 0.75, 0.19, 27, PAPER_DARK, AA);
checkFixed("dark --success on --paper", 0.8, 0.18, 152, PAPER_DARK, AA);
checkFixed("dark --success on --surface", 0.8, 0.18, 152, SURFACE_DARK, AA);

// AAA-committed text tokens (UI_DESIGN.md / token-layer proposal "#keep" —
// nothing here should move contrast down). These are FIXED colours
// (re-expressed hex->oklch at the same point in space, not hue-swept), so a
// literal-value check against the documented figures, not a hue sweep.
function checkExact(label, rgb, bg, minRatio) {
  const r = contrast(rgb, bg);
  const ok = r >= minRatio;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${r.toFixed(2)}:1 (floor ${minRatio}:1)`);
  if (!ok) failures.push(label);
}

// NOTE: --text-muted clears AAA (7:1) against --surface (white/near-black
// cards) but only AA (4.5:1) against --paper — this sweep script is what
// surfaced that nuance; the design proposal's "~7:1 AAA" figure holds for
// --text-muted-on-surface, not uniformly for every text/background pairing.
// Both floors are asserted at the level they actually clear, not rounded up.
checkExact("light --text-muted on --paper (AA floor)", oklchToRgb(0.462, 0.028, 304), PAPER_LIGHT, AA);
checkExact("light --text-muted on --surface (AAA-committed)", oklchToRgb(0.462, 0.028, 304), SURFACE_LIGHT, AAA);
checkExact("light --text-h on --paper", oklchToRgb(0.13, 0.017, 298.9), PAPER_LIGHT, AAA);
checkExact("light --text on --paper (AA floor)", oklchToRgb(0.514, 0.03, 305.5), PAPER_LIGHT, AA);
checkExact("dark --text-muted on --paper (AA floor)", oklchToRgb(0.672, 0.02, 265.9), PAPER_DARK, AA);
checkExact("dark --text-h on --paper", oklchToRgb(0.967, 0.003, 264.5), PAPER_DARK, AAA);
checkExact("dark --text on --paper (AA floor)", oklchToRgb(0.714, 0.019, 261.3), PAPER_DARK, AA);

console.log();
if (failures.length) {
  console.error(`Contrast sweep FAILED: ${failures.length} pairing(s) below threshold.`);
  console.error(failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log("Contrast sweep passed.");
