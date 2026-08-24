import type { ReactNode } from "react";
import styles from "./ListSection.module.css";

export interface ListSectionProps {
  readonly heading: string;
  readonly children: ReactNode;
  /**
   * "grid" reflows the children into a multi-column card grid instead of a
   * single stacked list — opt-in, and (see `ListSection.module.css`) only
   * takes visual effect within the 768-1439px tablet band; outside it this
   * renders identically to the default "list". Ingredients (tablet UI/UX
   * review, finding 3) is the only caller: it's a flat, alphabetical,
   * browsed catalogue with no scan order to protect, unlike Pantry/Shopping
   * (grouped by urgency/aisle) which never pass this and stay a single list
   * at every width. Pair with `ListRow`'s matching `card` prop.
   *
   * "grid2" is a SEPARATE mechanism, desktop-only (>=1440px — see
   * `ListSection.module.css`): a fixed 2-column split rather than "grid"'s
   * auto-fill/minmax reflow. Pantry (design/mock-desktop-density.html
   * §Pantry) is the only caller — its rows are wide (name + quantity +
   * freshness meter), unlike Ingredients' narrow flat cards, so a
   * proportional 2-up split suits it better than letting the row width
   * hunt for a `minmax` column count. "2, not 3" is a judgement call, not a
   * measured constraint (the mock's own words) — see that section's note.
   */
  readonly layout?: "list" | "grid" | "grid2";
}

/** Grouped heading over a set of `ListRow`/`CheckRow` children (UI_DESIGN.md §6) — the pantry groups lots by ingredient this way. */
export function ListSection({ heading, children, layout = "list" }: ListSectionProps) {
  const gridClass = layout === "grid" ? styles.rowsGrid : layout === "grid2" ? styles.rowsGrid2 : "";
  return (
    <section className={styles.section}>
      {/* h2, not h3: every route mounts this directly under its own <h1>
          (Recipes.tsx, Ingredients.tsx, Pantry.tsx, …) with no h2 of its
          own in between, so h3 here was a heading-order skip — axe's
          `heading-order` rule (WCAG 1.3.1) only surfaced it once a route
          reliably rendered a non-empty list during a scan (WP-21,
          2026-08-20: Ingredients' seeded catalog is the first list that's
          never empty on a fresh workbook). h2 matches Settings.tsx's own
          existing h1 -> h2 section heading. */}
      <h2 className={styles.heading}>{heading}</h2>
      <div className={`${styles.rows}${gridClass ? ` ${gridClass}` : ""}`}>{children}</div>
    </section>
  );
}
