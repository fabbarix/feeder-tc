import { describe, expect, it, vi } from "vitest";
import { createBrowserConnectivityMonitor, createManualConnectivityMonitor } from "./connectivity.ts";

describe("createManualConnectivityMonitor", () => {
  it("starts at the given initial state", () => {
    expect(createManualConnectivityMonitor(true).isOnline()).toBe(true);
    expect(createManualConnectivityMonitor(false).isOnline()).toBe(false);
  });

  it("notifies subscribers only on an actual change", () => {
    const monitor = createManualConnectivityMonitor(true);
    const listener = vi.fn();
    monitor.subscribe(listener);

    monitor.setOnline(true); // no change
    expect(listener).not.toHaveBeenCalled();

    monitor.setOnline(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(false);

    monitor.setOnline(true);
    expect(listener).toHaveBeenLastCalledWith(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("supports multiple subscribers and independent unsubscribe", () => {
    const monitor = createManualConnectivityMonitor(true);
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = monitor.subscribe(a);
    monitor.subscribe(b);

    monitor.setOnline(false);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    monitor.setOnline(true);
    expect(a).toHaveBeenCalledTimes(1); // unsubscribed, no further calls
    expect(b).toHaveBeenCalledTimes(2);
  });
});

describe("createBrowserConnectivityMonitor", () => {
  it("isOnline reads navigator.onLine", () => {
    const monitor = createBrowserConnectivityMonitor({ onLine: false });
    expect(monitor.isOnline()).toBe(false);
  });

  it("subscribe registers online/offline listeners and unsubscribe removes them", () => {
    const listeners = new Map<string, EventListener>();
    const events = {
      addEventListener: vi.fn((type: string, cb: EventListener) => {
        listeners.set(type, cb);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
    };

    const monitor = createBrowserConnectivityMonitor({ onLine: true }, events);
    const listener = vi.fn();
    const unsubscribe = monitor.subscribe(listener);

    expect(events.addEventListener).toHaveBeenCalledWith("online", expect.any(Function));
    expect(events.addEventListener).toHaveBeenCalledWith("offline", expect.any(Function));

    listeners.get("online")?.(new Event("online"));
    expect(listener).toHaveBeenCalledWith(true);

    listeners.get("offline")?.(new Event("offline"));
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
    expect(events.removeEventListener).toHaveBeenCalledWith("online", expect.any(Function));
    expect(events.removeEventListener).toHaveBeenCalledWith("offline", expect.any(Function));
  });
});
