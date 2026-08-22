import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ToastContext, type ToastContextValue } from "./ToastContext.ts";
import type { ToastInput, ToastRecord } from "./types.ts";

export interface ToastProviderProps {
  readonly children: ReactNode;
}

/**
 * Mount once near the root (see `main.tsx`) — above the router, so a toast
 * fired from any route survives navigation. `ToastViewport` (rendered by
 * `AppShell`) is the only consumer that renders the list; everything else
 * only ever calls `useToast()`.
 */
/**
 * Most toasts visible at once. Three fits comfortably above the phone tab bar
 * without reaching the primary content area; beyond that a burst buries the
 * very controls the person is using.
 */
const MAX_VISIBLE_TOASTS = 3;

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (toast: ToastInput): string => {
      const id = `toast-${nextId.current++}`;
      // Cap the visible stack. Toasts do auto-dismiss, but a burst of
      // actions produces them faster than they expire, and they stacked
      // without limit: on a 390px phone, five "Added to pantry." toasts
      // completely covered the Pantry item's "Record an event" rail — Use
      // some / Open / Move / Correct / Mark spoiled all unreachable until
      // the stack drained. Both the mobile and tablet UI reviews hit this
      // independently. Keeping only the newest few means a rapid sequence
      // shows the latest outcome without burying the controls that produced
      // it; the older ones have already been read, if they were read at all.
      setToasts((current) => [...current, { ...toast, id }].slice(-MAX_VISIBLE_TOASTS));
      if (toast.durationMs && toast.durationMs > 0) {
        const timer = setTimeout(() => dismissToast(id), toast.durationMs);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismissToast],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, showToast, dismissToast }),
    [toasts, showToast, dismissToast],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}
