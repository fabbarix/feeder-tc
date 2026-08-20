import type { ReactNode } from "react";
import { ArrowClockwise, WarningCircle } from "../icons.ts";
import styles from "./CheckRow.module.css";

export interface CheckRowProps {
  readonly label: string;
  readonly secondary?: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Quantity/badge slot, e.g. "400 g". */
  readonly trailing?: ReactNode;
  readonly disabled?: boolean;
  /** Set only after a flush genuinely fails — see `ListRow`'s doc comment; same rule applies here. */
  readonly failed?: boolean;
  readonly onRetry?: () => void;
}

/**
 * In-store variant (UI_DESIGN.md §6): larger than `ListRow`, and the WHOLE
 * row is the tap target — built as a native `<label>` wrapping a checkbox,
 * sized for one-handed use in a supermarket aisle. A checkbox is not one of
 * the banned native controls (UI_DESIGN.md §5 bans `<select>`,
 * `<input type="date">`, `<input type="number">`, `window.confirm`/`alert`)
 * — the native `<input type="checkbox">` + `<label>` pairing is already
 * fully accessible, so no react-aria hook is needed here.
 */
export function CheckRow({
  label,
  secondary,
  checked,
  onChange,
  trailing,
  disabled = false,
  failed = false,
  onRetry,
}: CheckRowProps) {
  return (
    <label className={`${styles.row}${failed ? ` ${styles.failed}` : ""}${checked ? ` ${styles.checked}` : ""}`}>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.text}>
        <span className={styles.primary}>{label}</span>
        {secondary ? <span className={styles.secondary}>{secondary}</span> : null}
        {failed ? (
          <span className={styles.failedNotice} role="status">
            <WarningCircle size={14} aria-hidden="true" />
            Failed to sync
            {onRetry ? (
              <button
                type="button"
                className={styles.retry}
                onClick={(event) => {
                  // Retry lives inside a <label>; stop the click reaching the
                  // checkbox input and toggling it as a side effect.
                  event.preventDefault();
                  event.stopPropagation();
                  onRetry();
                }}
              >
                <ArrowClockwise size={14} aria-hidden="true" />
                Retry
              </button>
            ) : null}
          </span>
        ) : null}
      </span>
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
    </label>
  );
}
