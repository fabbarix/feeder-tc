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
      setToasts((current) => [...current, { ...toast, id }]);
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
