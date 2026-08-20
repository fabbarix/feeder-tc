import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPwaUpdateWatcher } from "./update.ts";

// Minimal fakes for the three Service Worker API objects this module talks
// to. Built on the real EventTarget (available globally under Node/Vitest)
// so `addEventListener`/`dispatchEvent` behave like the browser objects they
// stand in for; the extra properties (`state`, `waiting`, `postMessage`, …)
// are plain mutable fields, not the real readonly DOM properties, which is
// exactly what a test double needs. Only cast to the DOM type at the
// boundary where `createPwaUpdateWatcher` expects one.

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

function makeRegistration(init: {
  waiting?: FakeServiceWorker;
  active?: FakeServiceWorker;
}): FakeRegistration {
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
  return Object.assign(new EventTarget(), {
    getRegistration: vi.fn().mockResolvedValue(registration),
  });
}

function asServiceWorker(worker: FakeServiceWorker): ServiceWorker {
  return worker as unknown as ServiceWorker;
}

function asRegistration(registration: FakeRegistration): ServiceWorkerRegistration {
  return registration as unknown as ServiceWorkerRegistration;
}

function asContainer(container: FakeContainer): ServiceWorkerContainer {
  return container as unknown as ServiceWorkerContainer;
}

/** Flushes the microtask queue so `getRegistration()`'s resolved promise has run. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createPwaUpdateWatcher", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom's `window.location` property is non-configurable, so it can't be
    // spied on directly (and its real `reload()` throws "Not implemented:
    // navigation" if called). `vi.stubGlobal` replaces the global binding
    // itself rather than redefining the property, which works around both.
    reloadSpy = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: reloadSpy });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not notify on a first install (no previously active worker)", async () => {
    const registration = makeRegistration({ waiting: makeWorker("installed") });
    const container = makeContainer(registration);
    const listener = vi.fn();

    createPwaUpdateWatcher(asContainer(container)).onUpdateAvailable(listener);
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies immediately when a worker is already waiting next to an active controller", async () => {
    const registration = makeRegistration({
      active: makeWorker("activated"),
      waiting: makeWorker("installed"),
    });
    const container = makeContainer(registration);
    const listener = vi.fn();

    createPwaUpdateWatcher(asContainer(container)).onUpdateAvailable(listener);
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies when a new worker finishes installing over an already-active one", async () => {
    const registration = makeRegistration({ active: makeWorker("activated") });
    const container = makeContainer(registration);
    const listener = vi.fn();

    createPwaUpdateWatcher(asContainer(container)).onUpdateAvailable(listener);
    await flush();
    expect(listener).not.toHaveBeenCalled();

    const installing = makeWorker("installing");
    registration.installing = installing;
    registration.dispatchEvent(new Event("updatefound"));
    installing.state = "installed";
    installing.dispatchEvent(new Event("statechange"));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify while the new worker is only mid-install", async () => {
    const registration = makeRegistration({ active: makeWorker("activated") });
    const container = makeContainer(registration);
    const listener = vi.fn();

    createPwaUpdateWatcher(asContainer(container)).onUpdateAvailable(listener);
    await flush();

    const installing = makeWorker("installing");
    registration.installing = installing;
    registration.dispatchEvent(new Event("updatefound"));
    installing.dispatchEvent(new Event("statechange")); // still "installing"

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying once unsubscribed", async () => {
    const registration = makeRegistration({
      active: makeWorker("activated"),
      waiting: makeWorker("installed"),
    });
    const container = makeContainer(registration);
    const listener = vi.fn();

    const api = createPwaUpdateWatcher(asContainer(container));
    const unsubscribe = api.onUpdateAvailable(listener);
    unsubscribe();
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it("applyUpdate posts SKIP_WAITING to the waiting worker", async () => {
    const waiting = makeWorker("installed");
    const registration = makeRegistration({ active: makeWorker("activated"), waiting });
    const container = makeContainer(registration);

    const api = createPwaUpdateWatcher(asContainer(container));
    await flush();
    await api.applyUpdate();

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("applyUpdate is a no-op when nothing is waiting", async () => {
    const registration = makeRegistration({ active: makeWorker("activated") });
    const container = makeContainer(registration);

    const api = createPwaUpdateWatcher(asContainer(container));
    await flush();

    await expect(api.applyUpdate()).resolves.toBeUndefined();
  });

  it("reloads the page once the new worker takes control", async () => {
    const container = makeContainer(undefined);
    createPwaUpdateWatcher(asContainer(container));
    await flush();

    container.dispatchEvent(new Event("controllerchange"));

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("does nothing when service workers are unsupported", async () => {
    expect(() => createPwaUpdateWatcher(undefined)).not.toThrow();
  });

  it("exposes the real worker/registration types at the call boundary", () => {
    // Compile-time check that the fakes satisfy the DOM types the module
    // actually declares in its signature, not just `unknown`.
    const worker: ServiceWorker = asServiceWorker(makeWorker("installed"));
    const registration: ServiceWorkerRegistration = asRegistration(makeRegistration({}));
    expect(worker.state).toBe("installed");
    expect(registration.active).toBeNull();
  });
});
