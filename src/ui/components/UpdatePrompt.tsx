import { ArrowClockwise } from "../icons.ts";
import styles from "./UpdatePrompt.module.css";

export interface UpdatePromptProps {
  /** Applies the waiting service worker (WP-24, `src/pwa/update.ts`'s `applyUpdate()`) — the container wires this, never a direct import here (UI_DESIGN.md §7). Only ever called from this component's own button, i.e. a user gesture, so a deploy can never reload someone mid-shop. */
  readonly onReload: () => void;
}

/**
 * "A new version is available" prompt (UI_DESIGN.md §8/§13, WP-24). The
 * worker installs a new build and WAITS (`registerType: "prompt"` in
 * `vite.config.ts`) rather than self-activating — this is the only thing
 * that ever tells it to go ahead, and it only exists because a user pressed
 * the button below.
 *
 * `position: fixed` (see the CSS module) rather than an inline element in
 * `AppShell`'s normal flow: it can appear at any point during a session, and
 * UI_DESIGN.md §13's motion rule ("never animate layout or position") reads
 * as "never let a banner shove content down as it appears" — an overlay
 * reserves no flow space to shove, so there is nothing to animate.
 */
export function UpdatePrompt({ onReload }: UpdatePromptProps) {
  return (
    <div className={styles.root} role="status" aria-live="polite">
      <span className={styles.message}>New version available.</span>
      <button type="button" className={styles.reload} onClick={onReload}>
        <ArrowClockwise size={16} aria-hidden="true" />
        Reload
      </button>
    </div>
  );
}
