/**
 * JSX support module for `wp-24-offline-store-trip.steps.ts`. Split out for
 * two reasons:
 *
 * 1. Vitest's feature-file glob (`vitest.config.ts`) only matches
 *    `features/**\/*.steps.ts` — a plain `.ts` file, which cannot contain
 *    JSX syntax — so anything that renders React has to live elsewhere.
 * 2. `@amiceli/vitest-cucumber` runs every Given/When/Then as its OWN
 *    Vitest `it()`, and `src/testing/vitest.setup.ts` registers a global
 *    `afterEach(() => cleanup())` (required — see that file's comment on
 *    `globals: false`). That unmounts whatever a step rendered before the
 *    next step's callback runs, so nothing can rely on one React tree
 *    staying mounted (and its internal state alive) across steps.
 *
 * The fix here is the same one used elsewhere in this codebase for
 * non-React state across BDD steps (see `wp-17-offline-outbox.steps.ts`,
 * which keeps `outbox`/`connectivity`/etc. as plain closure variables): keep
 * the real state (checked / pendingCount / offline) as plain values owned
 * by the STEP file, and render a fresh, disposable `AppShell`/`CheckRow`
 * from that state whenever a step needs to assert on what the UI would show
 * — since both are pure functions of props, a freshly rendered instance is
 * behaviourally identical to a persisted one for assertion purposes. The
 * one place a real user interaction still happens is the check-off itself
 * (`renderCheckOffRow` + a real click), which is what exercises
 * `checkOffShoppingItem` and the real `Outbox`.
 *
 * What's real production code here: `checkOffShoppingItem` (WP-14),
 * `createLocalStorageOutbox` / `createOutboxSyncController` / `flushOutbox`
 * (WP-17), and `AppShell` / `CheckRow` (WP-15b/this WP). What's stubbed:
 * only the single hand-built shopping-list row standing in for WP-23's not
 * -yet-built list — see the step file's own header comment.
 */
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppShell, type ShellState } from "../src/ui/AppShell.tsx";
import { CheckRow } from "../src/ui/components/CheckRow.tsx";
import { ToastProvider } from "../src/ui/components/Toast/ToastProvider.tsx";
import {
  checkOffShoppingItem,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeQuantity,
  type WorkbookStore,
} from "../src/domain/index.ts";
import { createFakeRng, createManualClock } from "../src/domain/fakes/index.ts";
import { createOutboxSyncController, type OutboxSyncController } from "../src/sync/outbox-sync-controller.ts";
import type { ConnectivityMonitor } from "../src/sync/connectivity.ts";
import type { Outbox } from "../src/domain/contracts.ts";

const READY: ShellState = {
  kind: "ready",
  user: { name: "Fabio Torchetti", email: "fabbari@gmail.com" },
  workbookName: "Household planner",
};

/** A fresh, disposable render of the real `AppShell` banner for the given (offline, pendingCount) — see this module's header comment for why "fresh" is fine. */
export function renderAppShellBanner(offline: boolean, pendingCount: number) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <AppShell
            state={READY}
            onSignIn={() => undefined}
            onSignOut={() => undefined}
            onCreateWorkbook={() => undefined}
            onPickWorkbook={() => undefined}
            offline={offline}
            pendingCount={pendingCount}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
}

/** A fresh, disposable render of the real `CheckRow` standing in for WP-23's shopping-list row — see this module's header comment. */
export function renderCheckOffRow(checked: boolean, onChange: (checked: boolean) => void) {
  return render(<CheckRow label="rice" trailing="400 g" checked={checked} onChange={onChange} />);
}

/** The real check-off -> purchase-event -> outbox.enqueue path (WP-14 + WP-17), standing in for what WP-23's real row's `onChange` will call. */
export async function checkOffRice(outbox: Outbox): Promise<void> {
  const clock = createManualClock({
    now: makeIsoTimestamp("2026-08-20T09:00:00.000Z"),
    today: makeIsoDate("2026-08-20"),
  });
  const rng = createFakeRng(1);
  const event = checkOffShoppingItem(
    { ingredientId: makeIngredientId("rice"), neededQuantity: makeQuantity(400, "g"), location: "pantry" },
    clock,
    rng,
  );
  await outbox.enqueue(event);
}

/** Starts the real WP-17 sync controller — flushes on reconnect exactly as `App.tsx`'s `ShellContainer` wires it. Returns the unsubscribe. */
export function startSync(outbox: Outbox, workbookStore: WorkbookStore, connectivity: ConnectivityMonitor): () => void {
  const controller: OutboxSyncController = createOutboxSyncController({ outbox, workbookStore, connectivity });
  return controller.start();
}
