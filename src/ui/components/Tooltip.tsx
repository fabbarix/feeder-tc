import type { ReactNode } from "react";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  /** Mirrors the wrapped control's own `aria-label` — this is a HOVER/FOCUS
      convenience, never the only place the meaning lives (that's still the
      control's real accessible name). */
  readonly label: string;
  readonly children: ReactNode;
}

/**
 * Desktop progressive enhancement for icon-only controls
 * (design/mock-desktop-density.html brief: this app has 17 icon-only
 * buttons and a usability reviewer already flagged them as guesswork on
 * first encounter). Labels are never REMOVED to buy horizontal space
 * (CLAUDE.md's standing rule) — this only ADDS a hover/focus bubble on top
 * of a control that already carries its own `aria-label`; nothing here
 * changes what a screen reader announces.
 *
 * Pure CSS, no JS state: `Tooltip.module.css` shows `.bubble` only under
 * `:hover`/`:focus-within`, gated to `(hover: hover) and (pointer: fine)`
 * AND `>=1440px` so it can never appear on a touch tier — phone and
 * tablet have no hover to trigger it anyway, but the media query makes
 * that explicit rather than incidental (a tooltip that only sometimes
 * exists depending on unstated assumptions is exactly the kind of defect
 * this whole work package exists to avoid). `aria-hidden` on the bubble:
 * it is decoration for a sighted pointer user, not a second copy of the
 * accessible name for anyone else.
 */
export function Tooltip({ label, children }: TooltipProps) {
  return (
    <span className={styles.wrap}>
      {children}
      <span className={styles.bubble} aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
