import type { ReactNode } from "react";
import styles from "./EntityTable.module.css";

export interface EntityTableColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  readonly align?: "start" | "end";
}

export interface EntityTableProps<T> {
  readonly caption: string;
  readonly columns: readonly EntityTableColumn<T>[];
  readonly rows: readonly T[];
  readonly getRowKey: (row: T) => string;
  readonly emptyMessage?: string;
  /** Visually hides the caption (still read by screen readers) — set when an on-page `<h1>`/`<h2>` already names the table. */
  readonly hideCaption?: boolean;
}

/**
 * The ≥768px tabular case ONLY (UI_DESIGN.md §6) — retained where columns
 * genuinely mean something on a wide screen (ingredients, recipes, pantry
 * lots, shopping items). Below 768px this component renders nothing; the
 * caller is responsible for rendering `ListRow`/`ListSection`/`CheckRow`
 * for the mobile case instead, because CSS-reflowing a `<table>`'s rows
 * into cards (as the previous implementation did) changes `display` on
 * `<tr>`/`<td>` and drops their implicit ARIA table semantics in several
 * browsers — a reflowed table has the accessibility of a stack of `<div>`s
 * while still looking like it should announce as a table. Hiding the whole
 * table with `display: none` below the breakpoint has no such problem: a
 * hidden element is equally absent from the accessibility tree either way.
 */
export function EntityTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  emptyMessage = "Nothing to show.",
  hideCaption = false,
}: EntityTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <table className={styles.table}>
      <caption className={hideCaption ? "visually-hidden" : styles.caption}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" className={column.align === "end" ? styles.alignEnd : undefined}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={getRowKey(row)}>
            {columns.map((column) => (
              <td key={column.key} className={column.align === "end" ? styles.alignEnd : undefined}>
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
