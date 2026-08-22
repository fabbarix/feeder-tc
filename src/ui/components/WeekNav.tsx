import { useRef } from "react";
import { useButton } from "react-aria";
import { CaretLeft, CaretRight, type IconComponent } from "../icons.ts";
import styles from "./WeekNav.module.css";

export interface WeekNavProps {
  /** Human-readable week label, e.g. "Aug 17 – Aug 23". The caller computes it — this component has no date math. */
  readonly label: string;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly previousLabel?: string;
  readonly nextLabel?: string;
  /**
   * The "Today" shortcut beside the chevrons (design/mock-responsive.html —
   * present at every tier: "after navigating away there is no one-tap way
   * back to the current week" without it). Optional: `MonthGrid`'s own
   * click-a-day-to-jump-back affordance means a Today button isn't the
   * ONLY way back, but this is still the primary one every tier's mock
   * shows. Omitted entirely (not just hidden) when the caller has no
   * "today" concept to jump to.
   */
  readonly onToday?: () => void;
  readonly todayLabel?: string;
}

/**
 * Week view navigation (UI_DESIGN.md §5 "Dates"): previous/next chevrons +
 * label — deliberately no picker, because "no picker exists" for a week
 * view is the design decision, not a missing feature. Also used, unchanged,
 * for the month view's prev/next-month control (Plan.tsx) — same
 * component, different `label`/`onPrevious`/`onNext`, per the mock's own
 * `.weeknav` markup being identical across the week/month/quarter tiers.
 */
export function WeekNav({
  label,
  onPrevious,
  onNext,
  previousLabel = "Previous week",
  nextLabel = "Next week",
  onToday,
  todayLabel = "Today",
}: WeekNavProps) {
  return (
    <div className={styles.row}>
      <div className={styles.root}>
        <NavButton icon={CaretLeft} label={previousLabel} onPress={onPrevious} />
        <span className={styles.label} aria-live="polite">
          {label}
        </span>
        <NavButton icon={CaretRight} label={nextLabel} onPress={onNext} />
      </div>
      {onToday ? (
        <button type="button" className={styles.todayButton} onClick={onToday}>
          {todayLabel}
        </button>
      ) : null}
    </div>
  );
}

function NavButton({
  icon: Icon,
  label,
  onPress,
}: {
  readonly icon: IconComponent;
  readonly label: string;
  readonly onPress: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton({ "aria-label": label, onPress }, ref);
  return (
    <button {...buttonProps} ref={ref} type="button" className={styles.navButton}>
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}
