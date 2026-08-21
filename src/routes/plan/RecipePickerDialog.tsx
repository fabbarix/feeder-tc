import { useRef } from "react";
import { DismissButton, FocusScope, useDialog, useOverlay, usePreventScroll } from "react-aria";
import type { Recipe, RecipeId } from "../../domain/index.ts";
import { EmptyState } from "../../ui/components";
import { MagnifyingGlass } from "../../ui/icons.ts";
import styles from "./RecipePickerDialog.module.css";

export interface RecipePickerDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly recipes: readonly Recipe[];
  readonly onPick: (recipeId: RecipeId) => void;
  readonly onClose: () => void;
  /** Rendered as a secondary action alongside the list (e.g. "Clear this slot"). */
  readonly clearLabel?: string;
  readonly onClear?: () => void;
}

/**
 * Controllable recipe picker for the Plan route's manual-pick flow
 * (WP-22): clicking a slot's name/"Pick a meal" opens this, driven by
 * external `open` state (`usePlanWeek`'s `pickerSlotId`) rather than an
 * internal trigger button — unlike `src/ui/components/SelectSheet.tsx`,
 * which only ever opens from its own button and has no external-open seam.
 * Same overlay primitives as `ConfirmDialog` (`useOverlay` + `FocusScope` +
 * `useDialog`), a plain button list instead of a search box: the candidate
 * pool here (`pickableRecipesForTag`) is a handful of staple/in-rotation
 * recipes for one meal tag, not the whole catalog.
 */
export function RecipePickerDialog(props: RecipePickerDialogProps) {
  if (!props.open) return null;
  return <RecipePickerDialogContent {...props} />;
}

function RecipePickerDialogContent({
  title,
  recipes,
  onPick,
  onClose,
  clearLabel,
  onClear,
}: Omit<RecipePickerDialogProps, "open">) {
  const ref = useRef<HTMLDivElement>(null);
  usePreventScroll();
  const { overlayProps } = useOverlay({ isOpen: true, onClose, isDismissable: true }, ref);
  // `useDialog` mints the title's id itself and wires `dialogProps`'s
  // `aria-labelledby` to it — spreading `titleProps` onto the heading is
  // what connects the two; an `id` prop applied AFTER the spread would
  // silently override react-aria's id and break that link (caught via a
  // dev-only console warning: "A dialog must have a title...").
  const { dialogProps, titleProps } = useDialog({}, ref);

  return (
    <div className={styles.underlay}>
      <FocusScope contain restoreFocus autoFocus>
        <div {...overlayProps} {...dialogProps} ref={ref} className={styles.sheet}>
          <DismissButton onDismiss={onClose} />
          <h2 {...titleProps} className={styles.title}>
            {title}
          </h2>
          {recipes.length === 0 ? (
            <EmptyState
              icon={MagnifyingGlass}
              title="No recipes for this meal yet"
              description="Add a recipe tagged for this meal, or retire fewer of them, to pick one here."
            />
          ) : (
            <ul className={styles.list}>
              {recipes.map((recipe) => (
                <li key={recipe.id}>
                  <button
                    type="button"
                    className={styles.option}
                    onClick={() => {
                      onPick(recipe.id);
                      onClose();
                    }}
                  >
                    {recipe.name}
                    {recipe.status === "staple" ? <span className={styles.pill}>Staple</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {onClear && clearLabel ? (
            <button
              type="button"
              className={styles.clearButton}
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              {clearLabel}
            </button>
          ) : null}
          <DismissButton onDismiss={onClose} />
        </div>
      </FocusScope>
    </div>
  );
}
