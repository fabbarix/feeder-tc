/**
 * Regression coverage for the double-append data-integrity bug: App.tsx and
 * four route hooks (usePantryInventory, useScanFlow, usePlanWeek,
 * useShoppingList) each used to build their OWN `Outbox` +
 * `OutboxSyncController` for the same workbook. With App's controller
 * always live, any route hook that also built one meant two permanently
 * live controllers, both waking on the same reconnect and flushing the
 * same pending event — see outbox-registry.ts's header comment for the
 * full story. These tests prove the fix at the architecture level: exactly
 * one controller per workbook, ref-counted release, no leaked connectivity
 * subscription across a workbook switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeWorkbookStore } from "../domain/fakes/index.ts";
import { makeEventId, makeIngredientId, makeIsoTimestamp, makeQuantity, type InventoryEvent } from "../domain/types.ts";
import { createManualConnectivityMonitor, type ConnectivityMonitor } from "./connectivity.ts";
import { acquireSharedOutboxSync, __resetSharedOutboxSyncRegistryForTests } from "./outbox-registry.ts";

function useEvent(id: string): InventoryEvent {
  return {
    type: "use",
    id: makeEventId(id),
    timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    ingredientId: makeIngredientId("rice"),
    quantity: makeQuantity(100, "g"),
  };
}

/** Wraps a real ConnectivityMonitor with spies on subscribe/unsubscribe, so a test can assert exactly how many live subscriptions exist at any point. */
function spyConnectivity(initialOnline = true): ConnectivityMonitor & {
  readonly subscribeCalls: () => number;
  readonly unsubscribeCalls: () => number;
  readonly setOnline: (online: boolean) => void;
} {
  const real = createManualConnectivityMonitor(initialOnline);
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  return {
    isOnline: () => real.isOnline(),
    subscribe(listener) {
      subscribeCalls += 1;
      const unsub = real.subscribe(listener);
      return () => {
        unsubscribeCalls += 1;
        unsub();
      };
    },
    setOnline: (online: boolean) => real.setOnline(online),
    subscribeCalls: () => subscribeCalls,
    unsubscribeCalls: () => unsubscribeCalls,
  };
}

describe("acquireSharedOutboxSync", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetSharedOutboxSyncRegistryForTests();
  });

  afterEach(() => {
    __resetSharedOutboxSyncRegistryForTests();
  });

  it("returns the SAME Outbox and Controller instances on a second acquire() for the same workbook", () => {
    const workbookStore = createFakeWorkbookStore();
    const connectivity = spyConnectivity(false);

    const first = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity });
    const second = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity });

    expect(second.outbox).toBe(first.outbox);
    expect(second.controller).toBe(first.controller);
    // Only the FIRST acquire() actually built (and started) anything —
    // exactly one connectivity subscription for two acquirers, not two.
    expect(connectivity.subscribeCalls()).toBe(1);

    first.release();
    second.release();
  });

  it("does not tear down the connectivity subscription until EVERY acquirer has released (ref-counting)", () => {
    const workbookStore = createFakeWorkbookStore();
    const connectivity = spyConnectivity(false);

    const first = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity });
    const second = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity });

    first.release();
    expect(connectivity.unsubscribeCalls()).toBe(0); // second acquirer is still holding it

    second.release();
    expect(connectivity.unsubscribeCalls()).toBe(1); // now torn down
  });

  it("release() is idempotent — calling it twice does not double-decrement the ref count", () => {
    const workbookStore = createFakeWorkbookStore();
    const connectivity = spyConnectivity(false);

    const first = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity });
    const second = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity });

    first.release();
    first.release(); // extra call — must not affect second's share
    expect(connectivity.unsubscribeCalls()).toBe(0);

    second.release();
    expect(connectivity.unsubscribeCalls()).toBe(1);
  });

  it("switching workbooks does not leak the old workbook's connectivity subscription", () => {
    const workbookStore = createFakeWorkbookStore();
    const connectivityA = spyConnectivity(false);
    const connectivityB = spyConnectivity(false);

    const handleA = acquireSharedOutboxSync({ workbookId: "wb-a", workbookStore, connectivity: connectivityA });
    expect(connectivityA.subscribeCalls()).toBe(1);

    // The active workbook switches — the old handle is released before the
    // new one is acquired, exactly as App.tsx's/each route hook's effect
    // cleanup does when `workbookId` changes.
    handleA.release();
    expect(connectivityA.unsubscribeCalls()).toBe(1);

    const handleB = acquireSharedOutboxSync({ workbookId: "wb-b", workbookStore, connectivity: connectivityB });
    expect(connectivityB.subscribeCalls()).toBe(1);
    expect(handleB.outbox).not.toBe(handleA.outbox);
    expect(handleB.controller).not.toBe(handleA.controller);

    handleB.release();
    expect(connectivityB.unsubscribeCalls()).toBe(1);
    // The old workbook's monitor was never touched again after its own release.
    expect(connectivityA.unsubscribeCalls()).toBe(1);
  });

  it("two acquirers of the SAME workbook cannot double-append: both call flushNow() and only one append happens", async () => {
    // This is the actual production shape: App.tsx and a route hook both
    // acquire for the same workbookId. Before the fix, each built its own
    // controller; with the registry, both get the exact same one back.
    const workbookStore = createFakeWorkbookStore();
    const connectivity = createManualConnectivityMonitor(false);

    const appHandle = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity });
    const routeHandle = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity });

    await appHandle.outbox.enqueue(useEvent("evt-1"));

    // Both "controllers" (in fact the one shared instance) are asked to
    // flush at the same time — e.g. the route hook calling flushNow() right
    // after enqueueing, while App's own reconnect handler also fires.
    const [resultA, resultB] = await Promise.all([appHandle.controller.flushNow(), routeHandle.controller.flushNow()]);

    // `flushNow()`'s own coalescing (outbox-sync-controller.ts) means only
    // one of these actually ran flushOutbox(); the other reports "already
    // in flight" with nothing of its own to report.
    const flushedTotal = resultA.flushed.length + resultB.flushed.length;
    expect(flushedTotal).toBe(1);

    const rows = (await workbookStore.inventoryEvents.readFrom(0)).rows;
    expect(rows.filter((r) => r.id === makeEventId("evt-1"))).toHaveLength(1);
    expect(await appHandle.outbox.pending()).toEqual([]);

    appHandle.release();
    routeHandle.release();
  });

  it("onResult fans out to every current acquirer, not just whichever one triggered the flush", async () => {
    const workbookStore = createFakeWorkbookStore();
    const connectivity = createManualConnectivityMonitor(false);

    const resultsA = vi.fn();
    const resultsB = vi.fn();
    const handleA = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity, onResult: resultsA });
    const handleB = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity, onResult: resultsB });

    await handleB.outbox.enqueue(useEvent("evt-1"));
    await handleB.controller.flushNow();

    expect(resultsA).toHaveBeenCalledWith(expect.objectContaining({ remaining: 0 }));
    expect(resultsB).toHaveBeenCalledWith(expect.objectContaining({ remaining: 0 }));

    handleA.release();
    handleB.release();
  });

  it("a released acquirer's onResult callback stops being called, but the controller keeps running for the remaining acquirer", async () => {
    const workbookStore = createFakeWorkbookStore();
    const connectivity = createManualConnectivityMonitor(false);

    const resultsA = vi.fn();
    const resultsB = vi.fn();
    const handleA = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity, onResult: resultsA });
    const handleB = acquireSharedOutboxSync({ workbookId: "wb-1", workbookStore, connectivity, onResult: resultsB });

    handleA.release();

    await handleB.outbox.enqueue(useEvent("evt-1"));
    await handleB.controller.flushNow();

    expect(resultsA).not.toHaveBeenCalled();
    expect(resultsB).toHaveBeenCalledWith(expect.objectContaining({ remaining: 0 }));

    handleB.release();
  });
});
