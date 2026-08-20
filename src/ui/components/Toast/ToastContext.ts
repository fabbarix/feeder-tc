import { createContext } from "react";
import type { ToastInput, ToastRecord } from "./types.ts";

export interface ToastContextValue {
  readonly toasts: readonly ToastRecord[];
  readonly showToast: (toast: ToastInput) => string;
  readonly dismissToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | undefined>(undefined);
