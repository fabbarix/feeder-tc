import type { DataWarning } from "../../../domain/contracts.ts";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastInput {
  readonly variant: ToastVariant;
  readonly title: string;
  readonly description?: string;
  /** Milliseconds before auto-dismiss; omit (or 0) to require manual dismiss. */
  readonly durationMs?: number;
}

export interface ToastRecord extends ToastInput {
  readonly id: string;
}

/**
 * Turns a WP-11 `DataWarning` (malformed workbook row) into toast content.
 * This is the wiring point named in WP-15's scope ("toast/warning surface
 * is where WP-11's data warnings get shown") — a later package calls
 * `useToast().showWarning(warning)` for each `DecodeResult.warnings` entry
 * it receives.
 */
export function toastFromDataWarning(warning: DataWarning): ToastInput {
  return {
    variant: "warning",
    title: `Skipped row ${warning.row} in ${warning.sheet}`,
    description: warning.reason,
  };
}
