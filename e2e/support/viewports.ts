/**
 * The three window sizes the owner asked the journey suite to prove out
 * (owner's words: "runs on mobile, tablet and desktop sized windows") —
 * shared between `playwright.config.ts` (which defines a Playwright project
 * per tier, so every `journey-*`/`reach-*` spec runs three times, once per
 * tier, with zero per-test viewport plumbing) and any spec that needs to
 * branch its OWN assertions on which tier it is currently running under
 * (e.g. "the servings stepper only renders at phone width").
 *
 * Deliberately plain viewport sizes on a Desktop-Chrome base — no
 * `devices["Pixel 7"]`-style touch/isMobile emulation for the phone tier.
 * `e2e/m6-scan-reachable.spec.ts` already established this exact
 * (390×844 / 1024×1366 / 1512×950) convention via `page.setViewportSize`
 * with no device emulation change; matching it here keeps one convention
 * for "what does phone/tablet/desktop mean" across the whole E2E suite
 * rather than inventing a second, subtly different one.
 */
export interface Tier {
  readonly name: "phone" | "tablet" | "desktop";
  readonly width: number;
  readonly height: number;
}

export const TIERS: readonly Tier[] = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "desktop", width: 1512, height: 950 },
];

/**
 * The app's main layout breakpoint — `AppShell`'s nav switches from a mobile
 * bottom tab bar to an inline top bar at 768px, and most route-level "wide
 * rail" treatments (Pantry's filters, Shopping's why-rail, the two-column
 * Settings/Recipe-detail grid) reuse that SAME 768px query. Exported so a
 * spec can say "is this tier wide enough for the rail" without re-deriving
 * the number.
 *
 * NOT the only breakpoint any more (updated, tablet UI/UX review): Plan's
 * `.week`/`.weekBands` (plan.module.css) also switches at 1440px, splitting
 * 768px+ into a genuine tablet band (768-1439px) and a desktop band
 * (>=1440px) for that one screen — `design/mock-responsive.html`'s
 * tier-strip narrative is no longer purely aspirational there.
 *
 * Ingredients' card grid (ListRow/ListSection's `variant="card"`/
 * `layout="grid"`) used to switch at 1440px too, the same as Plan — but
 * that was itself the bug fixed 2026-08-23 (a tablet-only mechanism nobody
 * extended upward, both in the grid's own media query and in its
 * container's width, AppShell.tsx's now-removed `TABLET_WIDE_ROUTES`/
 * `.mainTabletWide`). It now runs at every width from 768px up with no
 * 1440px split at all.
 */
export const WIDE_BREAKPOINT_PX = 768;

/** Derives a tier's name from a live page's current viewport width — for a spec that already has a `page` and wants to branch without importing `TIERS` and re-finding itself in it. */
export function tierNameFromWidth(width: number): Tier["name"] {
  const tier = TIERS.find((t) => width <= t.width);
  return tier?.name ?? "desktop";
}
