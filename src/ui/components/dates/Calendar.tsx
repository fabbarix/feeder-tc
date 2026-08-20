import { useRef } from "react";
import { useButton, useCalendar, useCalendarCell, useCalendarGrid, useLocale, type AriaButtonProps } from "react-aria";
import { useCalendarState, type CalendarState } from "react-stately";
import { createCalendar, getWeeksInMonth, parseDate, type CalendarDate } from "@internationalized/date";
import { makeIsoDate, type IsoDate } from "../../../domain/types.ts";
import { CaretLeft, CaretRight, type IconComponent } from "../../icons.ts";
import styles from "./Calendar.module.css";

export interface CalendarProps {
  /** Selected date, or `null` for none yet — this is the escape-hatch calendar behind "Pick…" (UI_DESIGN.md §5), not usually pre-filled. */
  readonly value: IsoDate | null;
  readonly onChange: (date: IsoDate) => void;
  readonly "aria-label": string;
  readonly minValue?: IsoDate;
  readonly maxValue?: IsoDate;
}

/**
 * The React Aria calendar behind every `Pick…` chip (UI_DESIGN.md §5
 * "Dates"). Never handles a JS `Date` — converts at the edges only, via
 * `@internationalized/date`'s `CalendarDate` (timezone-free), never
 * `toDate(timeZone)`. Built on `useCalendar`/`useCalendarGrid`/
 * `useCalendarCell` (react-aria) + `useCalendarState` (react-stately): our
 * own `<table>` markup, their keyboard navigation and ARIA grid semantics.
 */
export function Calendar({ value, onChange, minValue, maxValue, ...aria }: CalendarProps) {
  const { locale } = useLocale();
  const state = useCalendarState({
    createCalendar,
    locale,
    onChange: (date: CalendarDate) => onChange(makeIsoDate(date.toString())),
    ...(value !== null ? { value: parseDate(value) } : {}),
    ...(minValue !== undefined ? { minValue: parseDate(minValue) } : {}),
    ...(maxValue !== undefined ? { maxValue: parseDate(maxValue) } : {}),
  });

  const { calendarProps, prevButtonProps, nextButtonProps, title } = useCalendar(
    { "aria-label": aria["aria-label"] },
    state,
  );

  return (
    <div {...calendarProps} className={styles.root}>
      <div className={styles.header}>
        <NavButton {...prevButtonProps} icon={CaretLeft} label="Previous month" />
        <h3 className={styles.title}>{title}</h3>
        <NavButton {...nextButtonProps} icon={CaretRight} label="Next month" />
      </div>
      <CalendarGrid state={state} />
    </div>
  );
}

function NavButton({
  icon: Icon,
  label,
  ...buttonAriaProps
}: { readonly icon: IconComponent; readonly label: string } & AriaButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton({ ...buttonAriaProps, "aria-label": label }, ref);
  return (
    <button {...buttonProps} ref={ref} type="button" className={styles.navButton}>
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}

function CalendarGrid({ state }: { readonly state: CalendarState }) {
  const { locale } = useLocale();
  const { gridProps, headerProps, weekDays } = useCalendarGrid({}, state);
  const weeksInMonth = getWeeksInMonth(state.visibleRange.start, locale);

  return (
    <table {...gridProps} className={styles.grid}>
      <thead {...headerProps}>
        <tr>
          {weekDays.map((day, index) => (
            <th key={index}>{day}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...new Array(weeksInMonth).keys()].map((weekIndex) => (
          <tr key={weekIndex}>
            {state.getDatesInWeek(weekIndex).map((date, i) =>
              date ? <CalendarCell key={i} state={state} date={date} /> : <td key={i} />,
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CalendarCell({ state, date }: { readonly state: CalendarState; readonly date: CalendarDate }) {
  const ref = useRef<HTMLDivElement>(null);
  const { cellProps, buttonProps, isSelected, isOutsideVisibleRange, isDisabled, isUnavailable, formattedDate } =
    useCalendarCell({ date }, state, ref);

  return (
    <td {...cellProps}>
      <div
        {...buttonProps}
        ref={ref}
        hidden={isOutsideVisibleRange}
        className={`${styles.cell}${isSelected ? ` ${styles.cellSelected}` : ""}${
          isDisabled ? ` ${styles.cellDisabled}` : ""
        }${isUnavailable ? ` ${styles.cellUnavailable}` : ""}`}
      >
        {formattedDate}
      </div>
    </td>
  );
}
