import type { ReactNode } from "react";

/**
 * Seam for the header's workbook-name display. `AppShell` always passes
 * real `children` (the active workbook's name) derived from `ShellState`
 * when `state.kind === "ready"` — see `renderHeaderSlots` in
 * `../AppShell.tsx`.
 *
 * No fallback here for missing `children`, for the same reason as
 * `AuthStatusSlot` (UI_DESIGN.md §12, amended 2026-08-20): a hardcoded
 * "No workbook" placeholder that ignores the actual `ShellState` is a
 * state-blind default, which is worse than rendering nothing.
 */
export interface WorkbookSwitcherSlotProps {
  readonly children?: ReactNode;
}

export function WorkbookSwitcherSlot({ children }: WorkbookSwitcherSlotProps) {
  return (
    <div className="workbook-switcher-slot" data-slot="workbook-switcher">
      {children}
    </div>
  );
}
