/**
 * Online/offline detection (WP-17). `navigator.onLine` plus the
 * `online`/`offline` window events is the baseline, but it lies — a
 * connected-but-captive network reports online. This module only owns the
 * baseline signal; treating a failed flush as a second, corroborating
 * signal is `outbox-sync-controller.ts`'s job, layered on top of this
 * interface rather than folded into it, so the baseline stays trivially
 * fake-able in tests.
 */

export interface ConnectivityMonitor {
  isOnline(): boolean;
  /** Notifies on every online/offline transition. Returns an unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
}

/** Narrow event-target shape `createBrowserConnectivityMonitor` needs — deliberately not `typeof window`, so a test double doesn't have to match every overload of the real DOM `addEventListener`. */
export interface ConnectivityEventTarget {
  addEventListener(type: "online" | "offline", listener: (event: Event) => void): void;
  removeEventListener(type: "online" | "offline", listener: (event: Event) => void): void;
}

/**
 * Real browser implementation. `nav`/`events` are injectable (default
 * `navigator`/`window`) purely so a test can pass a fake without needing a
 * real DOM `Window` — jsdom already gives us a real one, but this keeps the
 * module usable outside jsdom too.
 */
export function createBrowserConnectivityMonitor(
  nav: Pick<Navigator, "onLine"> = navigator,
  events: ConnectivityEventTarget = window,
): ConnectivityMonitor {
  return {
    isOnline(): boolean {
      return nav.onLine;
    },
    subscribe(listener: (online: boolean) => void): () => void {
      const onOnline = (): void => listener(true);
      const onOffline = (): void => listener(false);
      events.addEventListener("online", onOnline);
      events.addEventListener("offline", onOffline);
      return () => {
        events.removeEventListener("online", onOnline);
        events.removeEventListener("offline", onOffline);
      };
    },
  };
}

export interface ManualConnectivityMonitor extends ConnectivityMonitor {
  /** Test/dev driver: flips the reported state and notifies subscribers, only on an actual change. */
  setOnline(online: boolean): void;
}

/** In-memory fake, injectable everywhere a `ConnectivityMonitor` is expected — how BDD/unit tests drive "the client is offline" / "connectivity returns". */
export function createManualConnectivityMonitor(initialOnline = true): ManualConnectivityMonitor {
  let online = initialOnline;
  const listeners = new Set<(online: boolean) => void>();
  return {
    isOnline(): boolean {
      return online;
    },
    subscribe(listener: (online: boolean) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setOnline(next: boolean): void {
      if (next === online) return;
      online = next;
      for (const listener of listeners) listener(online);
    },
  };
}
