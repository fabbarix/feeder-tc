import styles from "./FreshnessMeter.module.css";

export interface FreshnessMeterProps {
  /** Fraction of shelf life remaining: 1 = just purchased/opened, 0 = expiring today. Clamped to [0, 1]; the caller computes it from the lot's purchase/open date, shelf-life days and expiry — this component does no date math. */
  readonly fractionRemaining: number;
  /** Accessible label, e.g. "3 of 7 days remaining". Falls back to a percentage if omitted. */
  readonly label?: string;
}

const WARN_THRESHOLD = 0.25;

/**
 * Thin remaining-shelf-life bar under a pantry lot (UI_DESIGN.md §13
 * "Freshness as a visual cue") — makes "use this first" legible at a
 * glance instead of requiring the user to compare dates. Colour follows
 * §13's "only exceptions get colour" rule: fresh is neutral (`--line`,
 * not the accent — a colourful meter on every one of thirty pantry items
 * would be the "fruit salad" the rule exists to avoid), amber
 * (`--warn`) once shelf life is running low, red (`--crit`) once it's
 * gone. `--warn`/`--crit` are fixed hues (never derived from the
 * user's `--accent-hue`) so this reads correctly no matter which accent
 * colour someone has chosen — see src/index.css.
 */
export function FreshnessMeter({ fractionRemaining, label }: FreshnessMeterProps) {
  const clamped = Math.min(1, Math.max(0, fractionRemaining));
  const tone = clamped <= 0 ? "crit" : clamped <= WARN_THRESHOLD ? "warn" : "fresh";
  const toneClass = tone === "crit" ? styles.crit : tone === "warn" ? styles.warn : styles.fresh;

  return (
    <div
      className={styles.track}
      role="meter"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `${Math.round(clamped * 100)}% shelf life remaining`}
    >
      <div className={`${styles.fill} ${toneClass}`} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}
