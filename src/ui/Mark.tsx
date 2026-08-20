import styles from "./AppShell.module.css";

/**
 * The brand mark, inlined (not an `<img>`) so the tile can inherit the
 * live `--accent` via `currentColor` instead of being pinned to the baked
 * PWA-icon green (UI_DESIGN.md §11 explains why the *installed* icon can't
 * follow the user's chosen hue — that constraint is about the build-time
 * PNGs, not this live-rendered header mark, which has no such limitation).
 * Geometry copied from `public/logo.svg` (the source of truth for every
 * generated icon size) — see that file for why it's three plain filled
 * shapes and nothing else.
 */
export function Mark({ size = 28 }: { readonly size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Feeder" className={styles.mark}>
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <g transform="rotate(24 32 26.5)">
        <path d="M32 7 C38.5 13.5 38.5 20.5 32 26.5 C25.5 20.5 25.5 13.5 32 7 Z" fill="#fff" />
      </g>
      <rect x="8.5" y="29" width="47" height="6" rx="3" fill="#fff" />
      <path d="M13 37 C13 47.5 21.5 56 32 56 C42.5 56 51 47.5 51 37 Z" fill="#fff" />
    </svg>
  );
}
