import styles from "./Skeleton.module.css";

export interface SkeletonProps {
  /** CSS length, e.g. "1.2rem" or "100%". Defaults to a text-line height. */
  readonly height?: string;
  readonly width?: string;
  /** Rounds fully — for an avatar/icon placeholder rather than a text line. */
  readonly circle?: boolean;
  readonly label?: string;
}

/**
 * Loading placeholder (UI_DESIGN.md §10). Motion is a colour/opacity pulse
 * only, ~150ms-scale, and disabled entirely under `prefers-reduced-motion`
 * (`--motion-fast` resolves to `0ms` there — see `src/index.css`) — no
 * layout animation.
 */
export function Skeleton({ height = "1em", width = "100%", circle = false, label = "Loading" }: SkeletonProps) {
  return (
    <span
      className={`${styles.skeleton}${circle ? ` ${styles.circle}` : ""}`}
      style={{ height, width }}
      role="status"
      aria-label={label}
    />
  );
}
