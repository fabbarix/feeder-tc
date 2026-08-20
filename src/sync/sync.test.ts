import { describe, expect, it, vi } from "vitest";
import { createFakeSnapshotStore, createFakeWorkbookStore } from "../domain/fakes/index.ts";
import type { ApplyNewEvents, WorkbookStore } from "../domain/contracts.ts";
import {
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makeQuantity,
  type InventoryEvent,
  type Snapshot,
} from "../domain/types.ts";
import { previewSnapshotWithPending, syncSnapshot } from "./sync.ts";

function purchaseEvent(id: string): InventoryEvent {
  return {
    type: "purchase",
    id: makeEventId(id),
    timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    ingredientId: makeIngredientId("rice"),
    lotId: makeLotId(`lot-${id}`),
    quantity: makeQuantity(100, "g"),
    location: "pantry",
    purchaseDate: makeIsoDate("2026-03-01"),
  };
}

/** Minimal stand-in for WP-12's applyNewEvents: advances `cursor` by the event count and honours the generation-mismatch contract. Lot contents are irrelevant to these tests (cursor/generation behaviour only), so lots pass through unchanged. */
const trivialApply: ApplyNewEvents = (snapshot, events, meta) => {
  if (meta.generation !== snapshot.generation) {
    return { kind: "reload-required", reason: "generation mismatch" };
  }
  return {
    kind: "applied",
    snapshot: { generation: meta.generation, cursor: snapshot.cursor + events.length, lots: snapshot.lots },
  };
};

describe("syncSnapshot: incremental sync uses the cursor", () => {
  it("with a cached snapshot at cursor 120 and matching generation, only rows 121-125 are fetched and folded", async () => {
    const workbookStore = createFakeWorkbookStore();
    await workbookStore.meta.write({ schemaVersion: 1, generation: 1 });
    for (let i = 0; i < 125; i += 1) {
      await workbookStore.inventoryEvents.append(purchaseEvent(`evt-${i}`));
    }

    const readFromSpy = vi.fn(workbookStore.inventoryEvents.readFrom.bind(workbookStore.inventoryEvents));
    const spiedStore: WorkbookStore = {
      ...workbookStore,
      inventoryEvents: { ...workbookStore.inventoryEvents, readFrom: readFromSpy },
    };

    const snapshotStore = createFakeSnapshotStore();
    await snapshotStore.save("wb-1", { generation: 1, cursor: 120, lots: [] });

    const result = await syncSnapshot(
      { workbookStore: spiedStore, snapshotStore, applyNewEvents: trivialApply },
      "wb-1",
    );

    expect(readFromSpy).toHaveBeenCalledTimes(1);
    expect(readFromSpy).toHaveBeenCalledWith(120);
    expect(result.cursor).toBe(125);
    expect((await snapshotStore.load("wb-1"))?.cursor).toBe(125);
  });

  it("with no cached snapshot, does a full read from cursor 0", async () => {
    const workbookStore = createFakeWorkbookStore();
    await workbookStore.meta.write({ schemaVersion: 1, generation: 1 });
    await workbookStore.inventoryEvents.append(purchaseEvent("evt-1"));

    const readFromSpy = vi.fn(workbookStore.inventoryEvents.readFrom.bind(workbookStore.inventoryEvents));
    const spiedStore: WorkbookStore = {
      ...workbookStore,
      inventoryEvents: { ...workbookStore.inventoryEvents, readFrom: readFromSpy },
    };

    const snapshotStore = createFakeSnapshotStore();
    const result = await syncSnapshot(
      { workbookStore: spiedStore, snapshotStore, applyNewEvents: trivialApply },
      "wb-1",
    );

    expect(readFromSpy).toHaveBeenCalledWith(0);
    expect(result.cursor).toBe(1);
  });
});

describe("syncSnapshot: cursor safety (invariant 2)", () => {
  it("discards a cached snapshot whose generation does not match Meta and does a full re-read", async () => {
    const workbookStore = createFakeWorkbookStore();
    await workbookStore.meta.write({ schemaVersion: 1, generation: 2 });
    await workbookStore.inventoryEvents.append(purchaseEvent("evt-1"));
    await workbookStore.inventoryEvents.append(purchaseEvent("evt-2"));

    const snapshotStore = createFakeSnapshotStore();
    // Stale: generation 1, but Meta is now generation 2 (a compaction happened).
    await snapshotStore.save("wb-1", { generation: 1, cursor: 50, lots: [] });

    const clearSpy = vi.spyOn(snapshotStore, "clear");

    const result = await syncSnapshot({ workbookStore, snapshotStore, applyNewEvents: trivialApply }, "wb-1");

    expect(clearSpy).toHaveBeenCalledWith("wb-1");
    expect(result.generation).toBe(2);
    // Full re-read from 0, not resuming from the stale cursor 50.
    expect(result.cursor).toBe(2);
  });

  it("discards and does a full re-read when applyNewEvents itself reports reload-required", async () => {
    const workbookStore = createFakeWorkbookStore();
    await workbookStore.meta.write({ schemaVersion: 1, generation: 1 });
    await workbookStore.inventoryEvents.append(purchaseEvent("evt-1"));

    const snapshotStore = createFakeSnapshotStore();
    await snapshotStore.save("wb-1", { generation: 1, cursor: 0, lots: [] });

    let calls = 0;
    const flakyApply: ApplyNewEvents = (snapshot, events, meta) => {
      calls += 1;
      if (calls === 1) {
        return { kind: "reload-required", reason: "simulated mid-fold inconsistency" };
      }
      return trivialApply(snapshot, events, meta);
    };

    const result = await syncSnapshot({ workbookStore, snapshotStore, applyNewEvents: flakyApply }, "wb-1");
    expect(result.cursor).toBe(1);
    expect(await snapshotStore.load("wb-1")).toEqual(result);
  });
});

describe("previewSnapshotWithPending", () => {
  it("folds pending outbox events on top of the confirmed snapshot without advancing cursor/generation", () => {
    const confirmed: Snapshot = { generation: 3, cursor: 10, lots: [] };
    const pending = [purchaseEvent("pending-1"), purchaseEvent("pending-2")];

    const preview = previewSnapshotWithPending(confirmed, pending, { schemaVersion: 1, generation: 3 }, trivialApply);

    // trivialApply would have advanced cursor to 12 if this were a real sync
    // — the preview must NOT let that leak into what's returned.
    expect(preview.cursor).toBe(10);
    expect(preview.generation).toBe(3);
  });

  it("returns the confirmed snapshot unchanged when there is nothing pending", () => {
    const confirmed: Snapshot = { generation: 1, cursor: 5, lots: [] };
    expect(previewSnapshotWithPending(confirmed, [], { schemaVersion: 1, generation: 1 }, trivialApply)).toBe(
      confirmed,
    );
  });
});
