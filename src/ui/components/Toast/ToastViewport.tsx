import { X } from "../../icons.ts";
import { useToast } from "./useToast.ts";
import type { ToastVariant } from "./types.ts";
import styles from "./Toast.module.css";

const VARIANT_ROLE: Record<ToastVariant, "status" | "alert"> = {
  info: "status",
  success: "status",
  warning: "status",
  error: "alert",
};

const VARIANT_CLASS: Record<ToastVariant, string | undefined> = {
  info: undefined,
  success: styles.success,
  warning: styles.warning,
  error: styles.error,
};

/**
 * Renders the current toast queue. Mounted once by `AppShell`; every other
 * component only calls `useToast()` and never renders this directly.
 */
export function ToastViewport() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    // `role="region"` turns this into a proper landmark once it has
    // content (WP-20's a11y suite caught this: axe's "region" rule flags
    // ANY visible content outside a landmark, and a toast can appear while
    // the user is on an otherwise fully-landmarked route). An `aria-label`
    // alone supplies an accessible NAME, but only a role turns a <div> into
    // something landmark-aware tooling recognises as a region at all.
    <div className={styles.viewport} role="region" aria-label="Notifications">
      {/* Newest first, regardless of which edge the stack is anchored to
          (Toast.module.css: top on phone, bottom from 768px up) — rendering
          in arrival order buried the most recent message deepest, exactly
          the one the person just caused and most wants to read. With only
          ONE of `top`/`bottom` ever set (never both), the box grows away
          from its pinned edge, so the first DOM child always lands at the
          pinned edge itself — the most prominent slot either way. Reversing
          here, rather than in the provider, keeps `toasts` in arrival order
          for the dismissal timers and for tests. */}
      {[...toasts].reverse().map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast}${VARIANT_CLASS[toast.variant] ? ` ${VARIANT_CLASS[toast.variant]}` : ""}`}
          role={VARIANT_ROLE[toast.variant]}
          aria-live={toast.variant === "error" ? "assertive" : "polite"}
        >
          <div className={styles.body}>
            <p className={styles.title}>{toast.title}</p>
            {toast.description ? <p className={styles.description}>{toast.description}</p> : null}
          </div>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => dismissToast(toast.id)}
            aria-label={`Dismiss: ${toast.title}`}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
