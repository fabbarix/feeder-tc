import { useEffect, useRef, type ReactNode } from "react";
import "./ConfirmDialog.css";

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
 * Confirm/cancel dialog built on the native `<dialog>` element: `showModal()`
 * gives focus trapping, Escape-to-cancel, and a backdrop for free, so this
 * component does not hand-roll any of that a11y-sensitive behavior. Used for
 * WP-22's mark-cooked confirm/tweak screen and any other destructive or
 * confirm-before-you-commit action.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Feature-detect showModal/close rather than assuming they exist: every
    // evergreen browser (and Playwright's Chromium, which is what the
    // mandatory a11y/E2E checks run against) has full <dialog> support, but
    // jsdom (used for component tests) does not implement showModal/close
    // as of this writing — fall back to toggling the `open` attribute,
    // which jsdom does reflect, so component tests can still render and
    // interact with this component.
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? "confirm-dialog-description" : undefined}
      onCancel={(event) => {
        // Escape key fires the native "cancel" event; prevent the dialog's
        // own close so this stays a controlled component driven by `open`,
        // and let the caller decide (onCancel) whether to flip it off.
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="confirm-dialog-title" className="confirm-dialog__title">
        {title}
      </h2>
      {description ? (
        <div id="confirm-dialog-description" className="confirm-dialog__description">
          {description}
        </div>
      ) : null}
      <div className="confirm-dialog__actions">
        <button type="button" className="confirm-dialog__cancel" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`confirm-dialog__confirm${destructive ? " confirm-dialog__confirm--destructive" : ""}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
