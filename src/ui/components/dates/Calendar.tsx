import { useRef } from "react";
import { useButton, useCalendar, useCalendarCell, useCalendarGrid, useLocale, type AriaButtonProps } from "react-aria";
import { useCalendarState, type CalendarState } from "react-stately";
import { GregorianCalendar, getWeeksInMonth, parseDate, type CalendarDate } from "@internationalized/date";
import { makeIsoDate, type IsoDate } from "../../../domain/types.ts";
import { CaretLeft, CaretRight, type IconComponent } from "../../icons.ts";
import { Tooltip } from "../Tooltip.tsx";
import styles from "./Calendar.module.css";

/**
 * Always Gregorian — deliberately not `@internationalized/date`'s own
 * `createCalendar`, which resolves an arbitrary `CalendarIdentifier` at
 * runtime and, to do that, statically imports EVERY calendar system the
 * package ships (Islamic × 3 variants, Hebrew, Japanese, Ethiopic × 2,
 * Persian, Indian, Buddhist, Taiwanese, Coptic — none of it tree-shakeable,
 * since the dispatcher itself needs all of them reachable). Measured at
 * ~30 kB raw of the shared `components` chunk alone (WP-31 bundle
 * investigation, STATUS.md "Known debt").
 *
 * This app has no multi-calendar-system feature — `DESIGN.md`/`UI_DESIGN.md`
 * never mention one — and every date in the domain is a plain Gregorian ISO
 * string (`IsoDate`). Nothing here loses correctness by hardcoding Gregorian
 * regardless of the visitor's locale: `CalendarDate.toString()` normalises
 * to Gregorian internally before formatting either way. What this DOES
 * avoid is a locale-dependent surprise — a browser whose default calendar
 * for its locale is Islamic/Persian/etc. rendering an unrelated calendar
 * system in the "Pick…" escape hatch of an app that otherwise has no notion
 * of one, for no benefit since the result converts back to Gregorian ISO
 * regardless.
 */
function createGregorianCalendar(): GregorianCalendar {
  return new GregorianCalendar();
}

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
    createCalendar: createGregorianCalendar,
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
    <Tooltip label={label}>
      <button {...buttonProps} ref={ref} type="button" className={styles.navButton}>
        <Icon size={18} aria-hidden="true" />
      </button>
    </Tooltip>
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
