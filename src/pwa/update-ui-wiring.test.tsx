/**
 * Integration test for WP-24-UI's binding of `src/pwa/update.ts`'s
 * `createPwaUpdateWatcher` (already merged, PR #16 — see that file's own
 * `update.test.ts` for its unit coverage) to `AppShell`'s reload prompt.
 *
 * `update.test.ts` proves `applyUpdate()`'s own semantics (posts
 * SKIP_WAITING, no-ops when nothing is waiting, reloads once the new worker
 * takes control). This file proves the OTHER half — the thing `App.tsx`'s
 * `ShellContainer` actually wires: `onUpdateAvailable` flipping a piece of
 * React state that shows `AppShell`'s prompt, and `applyUpdate()` being
 * called if and only if a real user clicks that prompt's "Reload" button.
 * The fake `ServiceWorkerContainer`/`ServiceWorkerRegistration`/
 * `ServiceWorker` below are copied from `update.test.ts`'s own doubles
 * (kept minimal and local rather than shared, matching that file's own
 * "not the real readonly DOM properties" note).
 */
import { useCallback, useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppShell, type ShellState } from "../ui/AppShell.tsx";
import { ToastProvider } from "../ui/components/Toast/ToastProvider.tsx";
import { createPwaUpdateWatcher } from "./update.ts";

interface FakeServiceWorker extends EventTarget {
  state: string;
  postMessage: ReturnType<typeof vi.fn>;
}

function makeWorker(state: string): FakeServiceWorker {
  return Object.assign(new EventTarget(), { state, postMessage: vi.fn() });
}

interface FakeRegistration extends EventTarget {
  installing: FakeServiceWorker | null;
  waiting: FakeServiceWorker | null;
  active: FakeServiceWorker | null;
}

function makeRegistration(init: { waiting?: FakeServiceWorker; active?: FakeServiceWorker }): FakeRegistration {
  return Object.assign(new EventTarget(), {
    installing: null,
    waiting: init.waiting ?? null,
    active: init.active ?? null,
  });
}

interface FakeContainer extends EventTarget {
  getRegistration: ReturnType<typeof vi.fn>;
}

function makeContainer(registration: FakeRegistration | undefined): FakeContainer {
  return Object.assign(new EventTarget(), { getRegistration: vi.fn().mockResolvedValue(registration) });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const READY: ShellState = { kind: "ready", user: { name: "Fabio Torchetti", email: "fabbari@gmail.com" }, workbookName: "Household planner" };

/**
 * A minimal stand-in for `App.tsx`'s `ShellContainer` — real
 * `createPwaUpdateWatcher` wiring exactly as that container does it
 * (`onUpdateAvailable` -> state -> prop; `onApplyUpdate` -> `applyUpdate()`,
 * called from nowhere else), with everything ELSE `ShellContainer` also
 * does (auth, Sheets, routing) left out since it is irrelevant to this
 * seam.
 */
function TestShellContainer({ container }: { readonly container: FakeContainer }) {
  const [pwaUpdate] = useState(() => createPwaUpdateWatcher(container as unknown as ServiceWorkerContainer));
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => pwaUpdate.onUpdateAvailable(() => setUpdateAvailable(true)), [pwaUpdate]);
  const handleApplyUpdate = useCallback(() => {
    void pwaUpdate.applyUpdate();
  }, [pwaUpdate]);

  return (
    <AppShell
      state={READY}
      onSignIn={() => undefined}
      onSignOut={() => undefined}
      onCreateWorkbook={() => undefined}
      onPickWorkbook={() => undefined}
      updateAvailable={updateAvailable}
      onApplyUpdate={handleApplyUpdate}
    />
  );
}

function renderContainer(container: FakeContainer) {
  const router = createMemoryRouter(
    [{ path: "/", element: <TestShellContainer container={container} />, children: [{ index: true, element: <p>Home content</p> }] }],
    { initialEntries: ["/"] },
  );
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
}

describe("WP-24-UI: createPwaUpdateWatcher wired into AppShell's reload prompt", () => {
  it("shows no prompt while nothing is waiting", async () => {
    const container = makeContainer(makeRegistration({ active: makeWorker("activated") }));
    renderContainer(container);
    await flush();

    expect(screen.queryByText(/new version/i)).not.toBeInTheDocument();
  });

  it("shows the prompt once a new build finishes installing over an active one, and posts SKIP_WAITING only when the user clicks Reload", async () => {
    const user = userEvent.setup();
    const registration = makeRegistration({ active: makeWorker("activated") });
    const container = makeContainer(registration);
    renderContainer(container);
    await flush();

    expect(screen.queryByText(/new version/i)).not.toBeInTheDocument();

    // A new deploy: a worker starts installing, then finishes — exactly the
    // real browser sequence `update.ts`'s `watchRegistration` listens for.
    const installing = makeWorker("installing");
    registration.installing = installing;
    registration.dispatchEvent(new Event("updatefound"));
    installing.state = "installed";
    installing.dispatchEvent(new Event("statechange"));

    expect(await screen.findByText(/new version/i)).toBeInTheDocument();
    // The waiting worker must not be told to activate just because it
    // finished installing — only a user's own click may do that (the whole
    // point of `registerType: "prompt"`, so a deploy never hard-reloads
    // someone mid-shop).
    expect(installing.postMessage).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /reload/i }));
    expect(installing.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(installing.postMessage).toHaveBeenCalledTimes(1);
  });
});
