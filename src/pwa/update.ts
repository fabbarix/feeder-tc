/**
 * Versioned-update seam for WP-24's service worker.
 *
 * Registration itself needs no app code: `vite.config.ts`'s
 * `injectRegister: "auto"` has vite-plugin-pwa inject a tiny registration
 * script into the BUILT `index.html` (never the source file, which WP-24
 * must not touch — see IMPLEMENTATION_PLAN.md WP-24). That covers "install
 * the worker" but deliberately does nothing about reload UX: `registerType:
 * "prompt"` (also in `vite.config.ts`) means a new deploy installs in the
 * background and then WAITS — it never activates itself, so it can never
 * silently serve stale code (it simply isn't running yet) and can never
 * hard-reload a user mid-shop (nothing calls `applyUpdate()` but the UI).
 *
 * This module is that missing half: a small, framework/UI-agnostic API a
 * later work package (WP-15b/WP-24-UI, the component-kit agent) binds a
 * "New version — reload" prompt to. It talks to the standard Service Worker
 * API directly (not vite-plugin-pwa's `virtual:pwa-register` module) so it
 * has no build-time virtual-module dependency and is trivial to unit-test
 * with a fake `ServiceWorkerContainer` — see `update.test.ts`.
 *
 * Usage (for the UI agent):
 * ```ts
 * const pwaUpdate = createPwaUpdateWatcher();
 * const unsubscribe = pwaUpdate.onUpdateAvailable(() => {
 *   // show a "New version available — reload" prompt; call
 *   // pwaUpdate.applyUpdate() only if/when the user accepts it.
 * });
 * ```
 */

/** UI-agnostic API for the "a new version is available" reload prompt. */
export interface PwaUpdateApi {
  /**
   * Registers a listener invoked once a new service worker has finished
   * installing and is waiting to take over — i.e. a new deploy is ready.
   * Never fires for the very first install on a device (nothing was "stale"
   * yet), only for a genuine update over an already-active worker. Returns
   * an unsubscribe function.
   */
  onUpdateAvailable(listener: () => void): () => void;
  /**
   * Tells the waiting worker to activate; the page reloads itself once the
   * new worker takes control. Resolves immediately, without reloading, if
   * no update is currently waiting. Only ever call this from a user action
   * (e.g. the reload prompt's button) — never automatically, so a user
   * mid-shop is never reloaded out from under themselves.
   */
  applyUpdate(): Promise<void>;
}

const SKIP_WAITING_MESSAGE = { type: "SKIP_WAITING" } as const;

/**
 * @param serviceWorkerContainer Defaults to `navigator.serviceWorker`.
 * Overridable for tests, and safe to omit in environments without
 * service-worker support (`navigator.serviceWorker` is then `undefined` and
 * the returned API simply never fires).
 */
export function createPwaUpdateWatcher(
  serviceWorkerContainer: ServiceWorkerContainer | undefined = navigator.serviceWorker,
): PwaUpdateApi {
  const listeners = new Set<() => void>();
  let waitingWorker: ServiceWorker | undefined;
  let reloadingForUpdate = false;

  function notifyUpdateAvailable(worker: ServiceWorker): void {
    waitingWorker = worker;
    for (const listener of listeners) listener();
  }

  function watchRegistration(registration: ServiceWorkerRegistration): void {
    // A worker was already installed-and-waiting alongside an active
    // controller before this watcher attached (e.g. the update landed while
    // no listener was mounted yet).
    if (registration.waiting && registration.active) {
      notifyUpdateAvailable(registration.waiting);
    }
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        // `registration.active` distinguishes "first install on this
        // device" (nothing to update FROM) from "a new version replacing
        // one already in control".
        if (installing.state === "installed" && registration.active) {
          notifyUpdateAvailable(installing);
        }
      });
    });
  }

  if (serviceWorkerContainer) {
    void serviceWorkerContainer.getRegistration().then((registration) => {
      if (registration) watchRegistration(registration);
    });
    serviceWorkerContainer.addEventListener("controllerchange", () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      // eslint-disable-next-line no-restricted-syntax -- pattern-audit #2's ban targets ErrorState retry; this is the unrelated PWA "new version" reload, user-initiated via applyUpdate(), not a data re-fetch.
      window.location.reload();
    });
  }

  return {
    onUpdateAvailable(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async applyUpdate(): Promise<void> {
      if (!waitingWorker) return;
      waitingWorker.postMessage(SKIP_WAITING_MESSAGE);
    },
  };
}
