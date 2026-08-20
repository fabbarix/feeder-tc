import { useToast } from "./useToast.ts";
import type { ToastVariant } from "./types.ts";
import "./Toast.css";

const VARIANT_ROLE: Record<ToastVariant, "status" | "alert"> = {
  info: "status",
  success: "status",
  warning: "status",
  error: "alert",
};

/**
 * Renders the current toast queue. Mounted once by `AppShell`; every other
 * component only calls `useToast()` and never renders this directly.
 */
export function ToastViewport() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-viewport" aria-label="Notifications">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.variant}`}
          role={VARIANT_ROLE[toast.variant]}
          aria-live={toast.variant === "error" ? "assertive" : "polite"}
        >
          <div className="toast__body">
            <p className="toast__title">{toast.title}</p>
            {toast.description ? <p className="toast__description">{toast.description}</p> : null}
          </div>
          <button
            type="button"
            className="toast__dismiss"
            onClick={() => dismissToast(toast.id)}
            aria-label={`Dismiss: ${toast.title}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
