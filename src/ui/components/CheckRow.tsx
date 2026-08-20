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
 *
 * The check itself (UI_DESIGN.md §13) is "the single most repeated
 * interaction in the app" and gets real motion care: the native input still
 * carries the real accessible state (visually transparent but full-size,
 * same overlay technique as `SegmentedControl`'s hidden radio, so it stays
 * genuinely clickable), and a decorative SVG box draws its tick via
 * `stroke-dashoffset` — `pathLength="1"` normalizes the dasharray/dashoffset
 * to a 0–1 range regardless of the path's real geometry — while the label
 * grows a strike-through via a `::after` bar scaled with `transform:
 * scaleX()`. Both are driven by the `.checked` class, both animate on
 * `--motion-state` (220ms) with `--ease-standard`, both are inside
 * `prefers-reduced-motion` (that media query zeroes every `--motion-*`
 * token — see src/index.css). `transform: scaleX()` is a compositor-only
 * transform, never a layout reflow, in the same spirit as the spec's own
 * `stroke-dashoffset` example for the tick — not literally "colour/opacity"
 * either, but explicitly sanctioned as the one interaction worth animating
 * beyond that rule.
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
      <span className={styles.box} aria-hidden="true">
        <svg viewBox="0 0 24 24" className={styles.boxSvg}>
          <rect x="2" y="2" width="20" height="20" rx="6" className={styles.boxRect} />
          <path d="M6.5 12.5l4 4 8-9" pathLength="1" className={styles.boxCheck} />
        </svg>
      </span>
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
