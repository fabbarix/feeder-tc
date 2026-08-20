import { describe, expect, it, vi } from "vitest";
import { createFakeOutbox, createFakeWorkbookStore } from "../domain/fakes/index.ts";
import type { WorkbookStore } from "../domain/contracts.ts";
import { makeEventId, makeIngredientId, makeIsoTimestamp, makeQuantity, type InventoryEvent } from "../domain/types.ts";
import { createManualConnectivityMonitor } from "./connectivity.ts";
import { createOutboxSyncController } from "./outbox-sync-controller.ts";

function useEvent(id: string): InventoryEvent {
  return {
    type: "use",
    id: makeEventId(id),
    timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    ingredientId: makeIngredientId("rice"),
    quantity: makeQuantity(100, "g"),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createOutboxSyncController", () => {
  it("flushes immediately on start() when already online", async () => {
    const outbox = createFakeOutbox();
    await outbox.enqueue(useEvent("evt-1"));
    const workbookStore = createFakeWorkbookStore();
    const connectivity = createManualConnectivityMonitor(true);

    const results: number[] = [];
    const controller = createOutboxSyncController({
      outbox,
      workbookStore,
      connectivity,
      onResult: (r) => results.push(r.remaining),
    });

    const stop = controller.start();
    // start() fires flushNow() without awaiting it internally, so wait for
    // that in-flight flush to actually finish rather than assuming a fixed
    // number of microtask ticks.
    await vi.waitFor(async () => {
      expect(await outbox.pending()).toEqual([]);
    });

    expect(results).toEqual([0]);
    stop();
  });

  it("does not flush on start() while offline, and flushes exactly once connectivity returns", async () => {
    const outbox = createFakeOutbox();
    await outbox.enqueue(useEvent("evt-1"));
    const workbookStore = createFakeWorkbookStore();
    const connectivity = createManualConnectivityMonitor(false);

    const controller = createOutboxSyncController({ outbox, workbookStore, connectivity });
    const stop = controller.start();
    await Promise.resolve();

    expect(await outbox.pending()).toEqual([useEvent("evt-1")]); // untouched while offline

    connectivity.setOnline(true);
    await vi.waitFor(async () => {
      expect(await outbox.pending()).toEqual([]);
    });
    stop();
  });

  it("flushNow() can be called explicitly even while the monitor reports offline", async () => {
    const outbox = createFakeOutbox();
    await outbox.enqueue(useEvent("evt-1"));
    const workbookStore = createFakeWorkbookStore();
    const connectivity = createManualConnectivityMonitor(false);

    const controller = createOutboxSyncController({ outbox, workbookStore, connectivity });
    const result = await controller.flushNow();

    expect(result.remaining).toBe(0);
    expect(await outbox.pending()).toEqual([]);
  });

  it("does not run two flushes concurrently over the same outbox", async () => {
    const outbox = createFakeOutbox();
    await outbox.enqueue(useEvent("evt-1"));
    const workbookStore = createFakeWorkbookStore();
    const connectivity = createManualConnectivityMonitor(true);

    const gate = deferred<void>();
    let appendCalls = 0;
    const realAppend = workbookStore.inventoryEvents.append.bind(workbookStore.inventoryEvents);
    const gatedStore: WorkbookStore = {
      ...workbookStore,
      inventoryEvents: {
        ...workbookStore.inventoryEvents,
        append: async (event) => {
          appendCalls += 1;
          await gate.promise;
          await realAppend(event);
        },
      },
    };

    const controller = createOutboxSyncController({ outbox, workbookStore: gatedStore, connectivity });

    const first = controller.flushNow();
    // A second call while the first is still in-flight must not start a
    // second append for the same pending event.
    const second = controller.flushNow();

    gate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(appendCalls).toBe(1);
    expect(firstResult.flushed).toEqual([makeEventId("evt-1")]);
    expect(secondResult.flushed).toEqual([]); // reported "already in flight", not a second flush
    expect(await outbox.pending()).toEqual([]);
  });

  it("onResult is invoked with the flush outcome", async () => {
    const outbox = createFakeOutbox();
    const workbookStore = createFakeWorkbookStore();
    const connectivity = createManualConnectivityMonitor(true);
    const onResult = vi.fn();

    const controller = createOutboxSyncController({ outbox, workbookStore, connectivity, onResult });
    await controller.flushNow();

    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ remaining: 0 }));
  });
});
