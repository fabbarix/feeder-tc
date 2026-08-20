import type { ReactNode } from "react";

/**
 * Seam for WP-10's multi-workbook registry (switch/add a household
 * workbook). Same pattern as `AuthStatusSlot`: WP-10 injects its real
 * component via `AppShell`'s `workbookSwitcherSlot` prop rather than
 * editing this file.
 *
 *   <AppShell workbookSwitcherSlot={<RealWorkbookSwitcher />} />
 */
export interface WorkbookSwitcherSlotProps {
  readonly children?: ReactNode;
}

export function WorkbookSwitcherSlot({ children }: WorkbookSwitcherSlotProps) {
  return (
    <div className="workbook-switcher-slot" data-slot="workbook-switcher">
      {children ?? <span className="slot-placeholder">No workbook</span>}
    </div>
  );
}
