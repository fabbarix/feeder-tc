import { useId, useMemo, useRef, useState } from "react";
import { DismissButton, FocusScope, useButton, useListBox, useOption, useOverlay } from "react-aria";
import { Item, useListState, type ListState, type Node } from "react-stately";
import { CaretDown, Check, MagnifyingGlass } from "../icons.ts";
import styles from "./SelectSheet.module.css";

export interface SelectSheetOption<V extends string> {
  readonly value: V;
  readonly label: string;
}

export interface SelectSheetProps<V extends string> {
  readonly label: string;
  /** Large searchable set — the ingredient picker and the recipe picker are the only two uses (UI_DESIGN.md §5). Past ~4 options, this replaces a `SegmentedControl`/`ToggleChips`. */
  readonly options: readonly SelectSheetOption<V>[];
  readonly value: V | null;
  readonly onChange: (value: V) => void;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly id?: string;
}

/**
 * The kit's one general-purpose selector for large sets — a bottom sheet on
 * mobile, a popover at ≥768px (pure CSS breakpoint on the same markup, see
 * `SelectSheet.module.css`), with a search field. Built on `useListBox` +
 * `useOption` + `useListState` (the collection/keyboard-navigation
 * substrate) and `useOverlay` + `FocusScope` (dismiss + focus containment)
 * — no `react-aria-components`, our own DOM.
 */
export function SelectSheet<V extends string>({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  id,
}: SelectSheetProps<V>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const labelId = `${triggerId}-label`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [query, options]);

  const selected = options.find((option) => option.value === value) ?? null;

  function close(): void {
    setOpen(false);
    setQuery("");
  }

  const { buttonProps: triggerButtonProps } = useButton(
    { onPress: () => setOpen((current) => !current) },
    triggerRef,
  );

  const { overlayProps } = useOverlay(
    { isOpen: open, onClose: close, isDismissable: true, shouldCloseOnBlur: true },
    overlayRef,
  );

  return (
    <div className={styles.root}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <button
        {...triggerButtonProps}
        ref={triggerRef}
        type="button"
        id={triggerId}
        aria-labelledby={`${labelId} ${triggerId}`}
        className={styles.trigger}
      >
        <span className={selected ? styles.triggerValue : styles.triggerPlaceholder}>
          {selected ? selected.label : placeholder}
        </span>
        <CaretDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <>
          {/* Dismiss-only backdrop; Escape/outside-press are already handled by useOverlay on the sheet itself. */}
          <div className={styles.underlay} onClick={close} />
          <FocusScope contain restoreFocus autoFocus>
            <div {...overlayProps} ref={overlayRef} className={styles.sheet}>
              <DismissButton onDismiss={close} />
              <div className={styles.searchRow}>
                <MagnifyingGlass size={18} aria-hidden="true" className={styles.searchIcon} />
                <input
                  type="text"
                  className={styles.search}
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoFocus
                  aria-label={`Search ${label}`}
                />
              </div>
              <SheetListBox
                label={label}
                options={filtered}
                value={value}
                onSelect={(next) => {
                  onChange(next);
                  close();
                }}
              />
              <DismissButton onDismiss={close} />
            </div>
          </FocusScope>
        </>
      ) : null}
    </div>
  );
}

function SheetListBox<V extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  readonly label: string;
  readonly options: readonly SelectSheetOption<V>[];
  readonly value: V | null;
  readonly onSelect: (value: V) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const state = useListState<SelectSheetOption<V>>({
    items: options,
    children: (item) => (
      <Item key={item.value} textValue={item.label}>
        {item.label}
      </Item>
    ),
    selectionMode: "single",
    ...(value !== null ? { selectedKeys: [value] } : {}),
    onSelectionChange: (keys) => {
      if (keys === "all") return;
      const first = [...keys][0];
      if (typeof first === "string") onSelect(first as V);
    },
  });

  const { listBoxProps } = useListBox({ "aria-label": label, selectionMode: "single" }, state, listRef);

  return (
    <ul {...listBoxProps} ref={listRef} className={styles.list}>
      {[...state.collection].map((item) => (
        <Option key={item.key} item={item} state={state} />
      ))}
      {options.length === 0 ? <li className={styles.empty}>No matches.</li> : null}
    </ul>
  );
}

function Option<T>({ item, state }: { readonly item: Node<T>; readonly state: ListState<T> }) {
  const ref = useRef<HTMLLIElement>(null);
  const { optionProps, isSelected } = useOption({ key: item.key }, state, ref);
  return (
    <li {...optionProps} ref={ref} className={`${styles.option}${isSelected ? ` ${styles.optionSelected}` : ""}`}>
      {item.rendered}
      {isSelected ? <Check size={16} aria-hidden="true" /> : null}
    </li>
  );
}
