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

// A `toastFromDataWarning(warning: DataWarning)` mapper used to live here,
// turning a WP-11 `DataWarning` (malformed workbook row) directly into
// toast content. It was removed in WP-15b: `DataWarning` lives in
// src/domain/contracts.ts, which is outside the `src/ui/**` component
// boundary's allow-list (UI_DESIGN.md §7 allows only
// src/domain/{types,quantity,dates} — contracts.ts is not one of them, and
// the ESLint no-restricted-imports rule in eslint.config.js enforces this).
// A feature container (WP-20…) that has a DataWarning should call
// `useToast().showToast({ variant: "warning", title: ..., description: ... })`
// directly — a two-line inline mapping, not worth a shared helper that would
// otherwise be the ONLY thing pulling a domain interface type into the kit.
