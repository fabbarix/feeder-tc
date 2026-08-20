/**
 * React context handing the active workbook's `WorkbookStore` (plus a
 * `Clock`/`Rng`) down to feature routes. Provided once by `App.tsx`'s
 * `ShellContainer` — above `AppShell`'s `<Outlet />` — so every route
 * mounted in the "ready" state can reach it without threading props through
 * the router config. Not under `src/ui/**`, so it is free to depend on
 * `src/domain`'s contracts/engines (UI_DESIGN.md §7 only restricts the kit
 * itself); route components (`src/routes/**`) are likewise outside that
 * boundary and may import this directly.
 */
import { createContext, useContext } from "react";
import type { Clock, Rng, WorkbookStore } from "./domain/index.ts";

export interface WorkbookContextValue {
  readonly store: WorkbookStore;
  readonly clock: Clock;
  readonly rng: Rng;
  /**
   * The active workbook's spreadsheet id. `WorkbookStore` has no accessor
   * for it (it's an implementation detail of the transport it was built
   * from) but WP-17's per-workbook `SnapshotStore`/`Outbox` keying needs it
   * explicitly — added for WP-21, the first route to construct that sync
   * machinery.
   */
  readonly workbookId: string;
}

export const WorkbookContext = createContext<WorkbookContextValue | undefined>(undefined);

/**
 * Throws if called outside a workbook-ready route. Every route mounted by
 * `AppShell`'s `<Outlet />` only renders in the "ready" `ShellState`
 * (UI_DESIGN.md §12), and `App.tsx` only provides this context when a
 * workbook is active — so in practice this is always available to a route
 * component, and the throw is a programming-error guard, not a real runtime
 * path.
 */
export function useWorkbookContext(): WorkbookContextValue {
  const ctx = useContext(WorkbookContext);
  if (!ctx) {
    throw new Error("useWorkbookContext() called outside a workbook-ready route.");
  }
  return ctx;
}
