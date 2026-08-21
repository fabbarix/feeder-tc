import { describe, expect, it, vi } from "vitest";
import { createFakeOutbox, createFakeWorkbookStore } from "../domain/fakes/index.ts";
import type { WorkbookStore } from "../domain/contracts.ts";
import { makeEventId, makeIngredientId, makeIsoTimestamp, makeQuantity, type InventoryEvent } from "../domain/types.ts";
import { flushOutbox } from "./flush.ts";

function useEvent(id: string): InventoryEvent {
  return {
    type: "use",
    id: makeEventId(id),
    timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    ingredientId: makeIngredientId("rice"),
    quantity: makeQuantity(100, "g"),
  };
}

const noSleep = async (): Promise<void> => {};

/** Wraps a WorkbookStore's `append` to count calls and optionally intercept behaviour per call index (1-based). */
function withAppendSpy(
  base: WorkbookStore,
  onAppend: (callIndex: number, event: InventoryEvent, realAppend: (e: InventoryEvent) => Promise<void>) => Promise<void>,
): { store: WorkbookStore; calls: () => number } {
  let calls = 0;
  const realAppend = base.inventoryEvents.append.bind(base.inventoryEvents);
  const store: WorkbookStore = {
    ...base,
    inventoryEvents: {
      ...base.inventoryEvents,
      append: async (event: InventoryEvent) => {
        calls += 1;
        await onAppend(calls, event, realAppend);
      },
    },
  };
  return { store, calls: () => calls };
}

describe("flushOutbox: exactly-once under the 'server applied it, response lost' failure", () => {
  it("acknowledges the event and does not append a second row when the first append actually landed but threw", async () => {
    const base = createFakeWorkbookStore();
    const outbox = createFakeOutbox();
    await outbox.enqueue(useEvent("evt-1"));

    const { store, calls } = withAppendSpy(base, async (callIndex, event, realAppend) => {
      // First attempt: the server DOES apply it (real append happens)...
      await realAppend(event);
      if (callIndex === 1) {
        // ...but the client never sees that: simulate the lost response.
        throw new Error("simulated: response lost after server applied the append");
      }
    });

    const result = await flushOutbox({ outbox, workbookStore: store, sleep: noSleep });

    expect(result.flushed).toEqual([makeEventId("evt-1")]);
    expect(result.failure).toBeUndefined();
    expect(result.remaining).toBe(0);
    expect(await outbox.pending()).toEqual([]);

    // The critical assertion: append was attempted twice (the failing
    // attempt + the retry that discovered it via dedupe), but the sheet
    // holds the event exactly once.
    expect(calls()).toBe(1); // dedupe check short-circuits before a second append call
    const page = await base.inventoryEvents.readFrom(0);
    expect(page.rows.filter((row) => row.id === makeEventId("evt-1"))).toHaveLength(1);
  });

  it("retries a genuine transient failure (nothing applied) without duplicating once it succeeds", async () => {
    const base = createFakeWorkbookStore();
    const outbox = createFakeOutbox();
    await outbox.enqueue(useEvent("evt-1"));

    const { store, calls } = withAppendSpy(base, async (callIndex, event, realAppend) => {
      if (callIndex < 3) {
        throw new Error("simulated transient network failure, nothing applied");
      }
      await realAppend(event);
    });

    const result = await flushOutbox({ outbox, workbookStore: store, sleep: noSleep });

    expect(result.flushed).toEqual([makeEventId("evt-1")]);
    expect(result.remaining).toBe(0);
    expect(calls()).toBe(3);
    const page = await base.inventoryEvents.readFrom(0);
    expect(page.rows.filter((row) => row.id === makeEventId("evt-1"))).toHaveLength(1);
  });

  it("flushes pending events to InventoryEvents in FIFO order and empties the outbox", async () => {
    const base = createFakeWorkbookStore();
    const outbox = createFakeOutbox();
    await outbox.enqueue(useEvent("evt-1"));
    await outbox.enqueue(useEvent("evt-2"));

    const result = await flushOutbox({ outbox, workbookStore: base, sleep: noSleep });

    expect(result.flushed).toEqual([makeEventId("evt-1"), makeEventId("evt-2")]);
    expect(result.remaining).toBe(0);
    expect(await outbox.pending()).toEqual([]);

    const page = await base.inventoryEvents.readFrom(0);
    expect(page.rows.map((row) => row.id)).toEqual([makeEventId("evt-1"), makeEventId("evt-2")]);
  });

  it("stops at the first event that exhausts retries, leaving it and later events pending (FIFO preserved)", async () => {
    const base = createFakeWorkbookStore();
    const outbox = createFakeOutbox();
    await outbox.enqueue(useEvent("evt-1"));
    await outbox.enqueue(useEvent("evt-2"));

    const { store } = withAppendSpy(base, async () => {
      throw new Error("permanently broken");
    });

    const result = await flushOutbox({ outbox, workbookStore: store, sleep: noSleep, backoffMs: [1, 1] });

    expect(result.flushed).toEqual([]);
    expect(result.failure?.eventId).toBe(makeEventId("evt-1"));
    expect(result.remaining).toBe(2);
    expect((await outbox.pending()).map((e) => e.id)).toEqual([makeEventId("evt-1"), makeEventId("evt-2")]);

    const page = await base.inventoryEvents.readFrom(0);
    expect(page.rows).toEqual([]);
  });

  it("a second, independent flush pass over the same event does not duplicate it once the first has already landed (defence in depth for two outbox-sync controllers sharing one workbook)", async () => {
    // Two SEPARATE Outbox instances that both still hold evt-1 pending —
    // exactly the shape of the production bug this guards against: two
    // controllers, each backed by its own `createLocalStorageOutbox(workbookId)`
    // instance over the SAME localStorage key. Both see evt-1 as pending
    // because neither has acknowledged it yet; only ONE of them actually
    // gets to append it first.
    const base = createFakeWorkbookStore();
    const outboxA = createFakeOutbox();
    const outboxB = createFakeOutbox();
    await outboxA.enqueue(useEvent("evt-1"));
    await outboxB.enqueue(useEvent("evt-1"));

    // Controller A's flush runs to completion first — it appends evt-1 and
    // acknowledges it from ITS OWN outbox (outboxA). outboxB is untouched:
    // it still reports evt-1 as pending, because acknowledging is a local
    // operation on whichever Outbox instance did the flushing, not a
    // property of the shared ledger.
    const resultA = await flushOutbox({ outbox: outboxA, workbookStore: base, sleep: noSleep });
    expect(resultA.flushed).toEqual([makeEventId("evt-1")]);
    expect(await outboxB.pending()).toEqual([useEvent("evt-1")]); // still pending in B

    // Controller B's flush now runs, unaware that A already landed this
    // exact event. Without the pre-attempt dedupe check, `flushOne` would
    // call `append` directly on its first attempt (no error to trigger the
    // old retry-only check) and silently double the row.
    const resultB = await flushOutbox({ outbox: outboxB, workbookStore: base, sleep: noSleep });
    expect(resultB.flushed).toEqual([makeEventId("evt-1")]); // reports success...
    expect(await outboxB.pending()).toEqual([]); // ...and acknowledges, same as any successful flush

    // The critical assertion: the ledger holds evt-1 exactly once, not
    // twice, even though two independent flush passes both "successfully"
    // processed it.
    const page = await base.inventoryEvents.readFrom(0);
    expect(page.rows.filter((row) => row.id === makeEventId("evt-1"))).toHaveLength(1);
  });

  it("waits between retries using the injected sleep, not a real timer", async () => {
    const base = createFakeWorkbookStore();
    const outbox = createFakeOutbox();
    await outbox.enqueue(useEvent("evt-1"));

    const sleep = vi.fn(async () => {});
    const { store } = withAppendSpy(base, async (callIndex, event, realAppend) => {
      if (callIndex < 2) throw new Error("transient");
      await realAppend(event);
    });

    await flushOutbox({ outbox, workbookStore: store, sleep, backoffMs: [10, 20, 30] });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10);
  });
});
