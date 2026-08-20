import { createContext } from "react";
import type { DataWarning } from "../../../domain/contracts.ts";
import type { ToastInput, ToastRecord } from "./types.ts";

export interface ToastContextValue {
  readonly toasts: readonly ToastRecord[];
  readonly showToast: (toast: ToastInput) => string;
  readonly showWarning: (warning: DataWarning) => string;
  readonly dismissToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | undefined>(undefined);
