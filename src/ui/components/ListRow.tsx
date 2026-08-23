import type { ReactNode } from "react";
import { ArrowClockwise, WarningCircle } from "../icons.ts";
import styles from "./ListRow.module.css";

export interface ListRowProps {
  /** Icon or checkbox slot. */
  readonly leading?: ReactNode;
  readonly primary: ReactNode;
  readonly secondary?: ReactNode;
  /** Quantity/badge/action slot. */
  readonly trailing?: ReactNode;
  /**
   * Set only after a flush genuinely fails (WP-17 `SyncStorageError`) —
   * UI_DESIGN.md §8. Never set for "pending": pending is normal (a global
   * banner in `AppShell` covers it) and must read as "saved, will sync", not
   * "failed" — only a real failure earns the warning colour here.
   */
  readonly failed?: boolean;
  readonly onRetry?: () => void;
  /**
   * "card" swaps the border-bottom list-row treatment for a bordered,
   * rounded card — the pairing for `ListSection`'s `layout="grid"` (see
   * that component's doc comment). Like the grid it belongs inside, this
   * takes visual effect from 768px up with no upper bound
   * (ListRow.module.css); below that, `.row`'s ordinary list styling
   * applies regardless of this prop. Ingredients is the only caller.
   */
  readonly variant?: "row" | "card";
}

/**
 * The workhorse list layout primitive (UI_DESIGN.md §6): leading slot,
 * primary + secondary text, trailing slot, one `--touch-target` tall.
 * Purely presentational — no built-in press behavior, since the trailing
 * slot commonly holds its own interactive control (nesting a `<button>`
 * inside a pressable row would be invalid HTML). Wrap it in whatever
 * interaction the caller needs (a link, a button around just the text).
 */
export function ListRow({ leading, primary, secondary, trailing, failed = false, onRetry, variant = "row" }: ListRowProps) {
  return (
    <div className={`${styles.row}${variant === "card" ? ` ${styles.card}` : ""}${failed ? ` ${styles.failed}` : ""}`}>
      {leading ? <div className={styles.leading}>{leading}</div> : null}
      <div className={styles.text}>
        <div className={styles.primary}>{primary}</div>
        {secondary ? <div className={styles.secondary}>{secondary}</div> : null}
        {failed ? (
          <div className={styles.failedNotice} role="status">
            <WarningCircle size={14} aria-hidden="true" />
            <span>Failed to sync</span>
            {onRetry ? (
              <button type="button" className={styles.retry} onClick={onRetry}>
                <ArrowClockwise size={14} aria-hidden="true" />
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
    </div>
  );
}
