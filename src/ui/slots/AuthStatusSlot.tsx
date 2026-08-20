import type { ReactNode } from "react";

/**
 * Seam for WP-10's real auth status (signed-in email / sign-in button).
 * WP-15 only defines where it lives in the header and what it looks like
 * with nothing wired up yet — WP-10 does not implement auth here, it passes
 * its own component as `AppShell`'s `authStatusSlot` prop instead of editing
 * this file:
 *
 *   <AppShell authStatusSlot={<RealAuthStatus />} />
 *
 * Rendered as-is (no prop) when nothing has replaced it yet, so the seam is
 * visible during Stage 1 development instead of silently empty.
 */
export interface AuthStatusSlotProps {
  readonly children?: ReactNode;
}

export function AuthStatusSlot({ children }: AuthStatusSlotProps) {
  return (
    <div className="auth-status-slot" data-slot="auth-status">
      {children ?? <span className="slot-placeholder">Signed out</span>}
    </div>
  );
}
