import { useContext } from "react";
import { ToastContext, type ToastContextValue } from "./ToastContext.ts";

/**
 * Access the toast/warning surface from anywhere under `<ToastProvider>`
 * (mounted once in `App.tsx`, above the router). Feature packages call
 * `showToast` for general feedback (e.g. "saved", "check-off recorded") or
 * `showWarning` for a WP-11 `DataWarning` — see `toastFromDataWarning` in
 * `./types.ts` for the mapping.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}
