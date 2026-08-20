import type { ReactNode } from "react";
import styles from "./ListSection.module.css";

export interface ListSectionProps {
  readonly heading: string;
  readonly children: ReactNode;
}

/** Grouped heading over a set of `ListRow`/`CheckRow` children (UI_DESIGN.md §6) — the pantry groups lots by ingredient this way. */
export function ListSection({ heading, children }: ListSectionProps) {
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
      <div className={styles.rows}>{children}</div>
    </section>
  );
}
