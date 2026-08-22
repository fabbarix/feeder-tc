import type { IsoDate } from "../../domain/index.ts";
import type { DensityDot } from "./plan-derive.ts";
import { isInMonth, MONTH_GRID_DOW } from "./plan-month.ts";
import styles from "./MonthGrid.module.css";

export interface MonthGridProps {
  /** Every date the grid draws — `plan-month.ts`'s `monthGridDates` (always a multiple of 7, leading/trailing days from the adjacent month included). */
  readonly dates: readonly IsoDate[];
  /** The 1st of the month this grid is "about" — dates outside it (the leading/trailing weeks) render muted via `isInMonth`. */
  readonly monthStart: IsoDate;
  readonly today: IsoDate;
  readonly dotsByDate: ReadonlyMap<IsoDate, readonly DensityDot[]>;
  /**
   * Quarter mode (design/mock-responsive.html §"Month — an overview, not an
   * editor": "the exact same `.monthgrid` component at a smaller cell size
   * and with day numbers dropped ... one component, not two"): no
   * day-of-week header row, no day numbers, smaller cells.
   */
  readonly dense?: boolean;
  /** Clicking a day opens that week (mock: "this view answers 'what's ahead,' it doesn't let you edit a slot from here"). */
  readonly onSelectDay: (date: IsoDate) => void;
}

function dayNumber(date: IsoDate): string {
  return String(Number(date.slice(8, 10)));
}

/**
 * The month/quarter density grid — one cell per day, a dot per configured
 * slot that day (filled/leftover/empty), no recipe text at all ("a month of
 * recipe names would be illegible at any width"). Reused unchanged for the
 * quarter strip at `dense` — same component, lower density, per the mock's
 * explicit "design one component, not two."
 */
export function MonthGrid({ dates, monthStart, today, dotsByDate, dense = false, onSelectDay }: MonthGridProps) {
  return (
    <div className={`${styles.grid}${dense ? ` ${styles.dense}` : ""}`}>
      {dense
        ? null
        : // A static 7-item header row — position IS the identity, so an
          // index key is correct here, not just tolerated.
          MONTH_GRID_DOW.map((label, i) => (
            <span className={styles.dow} key={i} aria-hidden="true">
              {label}
            </span>
          ))}
      {dates.map((date) => {
        const dots = dotsByDate.get(date) ?? [];
        const muted = !isInMonth(date, monthStart);
        const isToday = date === today;
        const dotSummary =
          dots.length === 0
            ? "no meal slots"
            : dots
                .map((d) => (d === "empty" ? "an empty slot" : d === "leftover" ? "a leftover slot" : "a planned meal"))
                .join(", ");
        return (
          <button
            key={date}
            type="button"
            className={`${styles.cell}${muted ? ` ${styles.cellMute}` : ""}${isToday ? ` ${styles.cellToday}` : ""}`}
            onClick={() => onSelectDay(date)}
            aria-label={`${date}${isToday ? " (today)" : ""} — ${dotSummary} — open this week`}
          >
            {dense ? null : <span className={styles.dayNumber}>{dayNumber(date)}</span>}
            <span className={styles.dots}>
              {dots.length === 0 ? (
                <i className={`${styles.dot} ${styles.dotEmpty}`} aria-hidden="true" />
              ) : (
                // Dots have no identity beyond position within the day —
                // an index key is correct here, not just tolerated.
                dots.map((dot, i) => (
                  <i
                    key={i}
                    className={`${styles.dot}${dot === "empty" ? ` ${styles.dotEmpty}` : dot === "leftover" ? ` ${styles.dotLeftover}` : ""}`}
                    aria-hidden="true"
                  />
                ))
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
