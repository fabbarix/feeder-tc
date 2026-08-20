import type { ReactNode } from "react";
import "./EntityTable.css";

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
 * Generic list/browse table for any entity (ingredients, recipes, pantry
 * lots, shopping items, …) — WP-20…WP-23 supply columns/rows for their own
 * entity type. Renders semantic `<table>` markup for screen readers at every
 * viewport; on narrow viewports CSS re-flows each row into a labeled card
 * (see `EntityTable.css`) rather than switching DOM structure, so the
 * accessible structure never changes with viewport width.
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
      <div className="entity-table entity-table--empty">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <table className="entity-table">
      <caption className={hideCaption ? "visually-hidden" : undefined}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" className={`entity-table__align-${column.align ?? "start"}`}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={getRowKey(row)}>
            {columns.map((column) => (
              <td key={column.key} data-label={column.header} className={`entity-table__align-${column.align ?? "start"}`}>
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
