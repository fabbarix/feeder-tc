import { useId, useRef, type ReactNode } from "react";
import { DismissButton, FocusScope, useDialog, useOverlay, usePreventScroll } from "react-aria";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Styles the confirm button as a destructive action (e.g. discard/delete). */
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Confirm/cancel dialog built on `useDialog` + `useOverlay` (react-aria) —
 * UI_DESIGN.md §5 lists `window.confirm`/`alert` among the banned native
 * controls. `FocusScope` (`contain`) traps focus, `useOverlay`'s
 * `isDismissable` closes on outside press or Escape, and `usePreventScroll`
 * locks background scrolling while open — the same guarantees the earlier
 * native-`<dialog>` implementation got for free, reproduced explicitly so
 * the markup and styling stay entirely ours. Used for WP-22's mark-cooked
 * confirm/tweak screen and any other destructive or confirm-before-you-
 * commit action.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  return <ConfirmDialogContent {...props} />;
}

function ConfirmDialogContent({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Omit<ConfirmDialogProps, "open">) {
  const ref = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  usePreventScroll();
  const { overlayProps } = useOverlay({ isOpen: true, onClose: onCancel, isDismissable: true }, ref);
  // useDialog doesn't infer aria-describedby from a separately-rendered
  // description element — it has to be supplied explicitly, matching the id
  // put on that element below.
  const { dialogProps, titleProps } = useDialog(
    description !== undefined ? { "aria-describedby": descriptionId } : {},
    ref,
  );

  return (
    <div className={styles.underlay}>
      <FocusScope contain restoreFocus autoFocus>
        <div {...overlayProps} {...dialogProps} ref={ref} className={styles.dialog}>
          <DismissButton onDismiss={onCancel} />
          <h2 {...titleProps} className={styles.title}>
            {title}
          </h2>
          {description ? (
            <div id={descriptionId} className={styles.description}>
              {description}
            </div>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`${styles.confirm}${destructive ? ` ${styles.confirmDestructive}` : ""}`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
          <DismissButton onDismiss={onCancel} />
        </div>
      </FocusScope>
    </div>
  );
}
