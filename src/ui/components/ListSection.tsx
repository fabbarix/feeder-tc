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
      <h3 className={styles.heading}>{heading}</h3>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}
