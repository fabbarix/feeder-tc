import type { ReactNode } from "react";

/**
 * Seam for the header's auth-status display (name + avatar). `AppShell`
 * always passes real `children` derived from `ShellState` (see
 * `renderHeaderSlots` in `../AppShell.tsx`) — this component never renders
 * on its own without them.
 *
 * There is deliberately NO fallback here for missing `children`
 * (UI_DESIGN.md §12, amended 2026-08-20): an earlier version rendered a
 * hardcoded "Signed out" placeholder whenever nothing was passed in,
 * *regardless of the actual shell state* — so a signed-in user with no
 * workbook yet could see "Signed out" in the header while the body offered
 * "Sign out". A default that renders plausible-looking text without
 * consulting state is worse than no default: it looks correct and is
 * wrong. Rendering nothing when `children` is absent fails loudly (an empty
 * slot) instead of failing convincingly.
 */
export interface AuthStatusSlotProps {
  readonly children?: ReactNode;
}

export function AuthStatusSlot({ children }: AuthStatusSlotProps) {
  return (
    <div className="auth-status-slot" data-slot="auth-status">
      {children}
    </div>
  );
}
