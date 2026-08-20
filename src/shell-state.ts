/**
 * Pure derivation of `AppShell`'s `ShellState` from the three independent
 * bits of state `App.tsx`'s container tracks: the auth state machine
 * (`src/sheets/auth.ts`), the fetched user identity, and the workbook
 * registry's active entry (`src/sheets/registry.ts`). Kept as a standalone,
 * side-effect-free function — rather than inlined in the component — so it
 * is unit-testable without constructing a real `GoogleAuth`/DOM/React tree.
 */
import type { AuthState } from "./sheets/auth.ts";
import type { WorkbookRegistryEntry } from "./sheets/registry.ts";
import type { ShellState, ShellUser } from "./ui/AppShell.tsx";

/**
 * `user` and `activeWorkbook` are independent from `authState` in the
 * container's own state shape (see App.tsx) — this function is what
 * reconciles them into the one ShellState AppShell actually renders.
 *
 * - Not signed in, or signed in but the user identity hasn't resolved yet
 *   (or failed to): `signed-out`. A `ready`/`no-workbook` state with no
 *   `user` is not constructible (the type requires one) — treating an
 *   unresolved user as signed-out, rather than inventing a placeholder
 *   user, is what keeps that true.
 * - Signed in with a user but no remembered active workbook: `no-workbook`.
 * - Signed in with a user and a remembered active workbook (the registry
 *   persists across sessions even though the auth token never does — see
 *   registry.ts): `ready`.
 */
export function deriveShellState(
  authState: AuthState,
  user: ShellUser | undefined,
  activeWorkbook: WorkbookRegistryEntry | undefined,
): ShellState {
  if (authState === "signed-out" || !user) {
    return { kind: "signed-out" };
  }
  if (!activeWorkbook) {
    return { kind: "no-workbook", user };
  }
  return { kind: "ready", user, workbookName: activeWorkbook.name };
}
