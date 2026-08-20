import { beforeEach, describe, expect, it } from "vitest";
import { describeOutboxContract } from "../domain/contract-tests/index.ts";
import { createLocalStorageOutbox } from "./outbox.ts";
import { SyncStorageError } from "./storage.ts";
import { createThrowingStorage } from "./test-support/fake-storage.ts";
import { makeEventId, makeIngredientId, makeIsoTimestamp, makeQuantity, type InventoryEvent } from "../domain/types.ts";

function useEvent(id: string): InventoryEvent {
  return {
    type: "use",
    id: makeEventId(id),
    timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    ingredientId: makeIngredientId("rice"),
    quantity: makeQuantity(100, "g"),
  };
}

describe("localStorage Outbox", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // Shared behavioural contract (also run against the in-memory fake in
  // src/domain/fakes/outbox.test.ts) — proves the real localStorage-backed
  // implementation honours FIFO order and idempotent enqueue/acknowledge.
  describeOutboxContract(() => createLocalStorageOutbox("wb-1", window.localStorage));

  it("survives reload: a fresh instance constructed over the same storage sees prior enqueues", async () => {
    await createLocalStorageOutbox("wb-1", window.localStorage).enqueue(useEvent("evt-1"));

    const reloaded = createLocalStorageOutbox("wb-1", window.localStorage);
    expect(await reloaded.pending()).toEqual([useEvent("evt-1")]);
  });

  it("keys two workbooks under distinct localStorage keys (no cross-workbook bleed)", async () => {
    await createLocalStorageOutbox("wb-1", window.localStorage).enqueue(useEvent("evt-1"));
    await createLocalStorageOutbox("wb-2", window.localStorage).enqueue(useEvent("evt-2"));

    expect(await createLocalStorageOutbox("wb-1", window.localStorage).pending()).toEqual([useEvent("evt-1")]);
    expect(await createLocalStorageOutbox("wb-2", window.localStorage).pending()).toEqual([useEvent("evt-2")]);
  });

  it("pending() throws rather than silently reporting an empty queue when the stored JSON is corrupt", async () => {
    // Deliberately the opposite policy to SnapshotStore: a cache miss is
    // safe (triggers a full re-read), but "the outbox looks empty" when it
    // might not be is exactly how an offline write gets lost unnoticed
    // (invariant 9) — so this throws instead of swallowing.
    window.localStorage.setItem("feeder:outbox:v1:wb-1", "{ not valid json");
    const outbox = createLocalStorageOutbox("wb-1", window.localStorage);
    await expect(outbox.pending()).rejects.toBeInstanceOf(SyncStorageError);
  });

  it("enqueue throws SyncStorageError, and does not report success, when the underlying write fails", async () => {
    const throwing = createThrowingStorage({
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    });
    const outbox = createLocalStorageOutbox("wb-1", throwing);
    await expect(outbox.enqueue(useEvent("evt-1"))).rejects.toBeInstanceOf(SyncStorageError);
  });

  it("acknowledge is a genuine no-op write (no storage write attempted) when the id is not pending", async () => {
    // Regression guard: acknowledging a non-existent id must not throw even
    // over storage whose setItem always fails, because there's nothing to
    // persist in that case (readQueue().length === next.length short-circuit).
    const throwing = createThrowingStorage({
      setItem: () => {
        throw new Error("should not be called");
      },
    });
    const outbox = createLocalStorageOutbox("wb-1", throwing);
    await expect(outbox.acknowledge(makeEventId("does-not-exist"))).resolves.toBeUndefined();
  });
});
