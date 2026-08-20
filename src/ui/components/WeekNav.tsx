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
}

/**
 * Week view navigation (UI_DESIGN.md §5 "Dates"): previous/next chevrons +
 * label — deliberately no picker, because "no picker exists" for a week
 * view is the design decision, not a missing feature.
 */
export function WeekNav({
  label,
  onPrevious,
  onNext,
  previousLabel = "Previous week",
  nextLabel = "Next week",
}: WeekNavProps) {
  return (
    <div className={styles.root}>
      <NavButton icon={CaretLeft} label={previousLabel} onPress={onPrevious} />
      <span className={styles.label} aria-live="polite">
        {label}
      </span>
      <NavButton icon={CaretRight} label={nextLabel} onPress={onNext} />
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
