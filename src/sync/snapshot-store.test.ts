import { beforeEach, describe, expect, it } from "vitest";
import { describeSnapshotStoreContract } from "../domain/contract-tests/index.ts";
import { createLocalStorageSnapshotStore } from "./snapshot-store.ts";
import { SyncStorageError } from "./storage.ts";
import { createThrowingStorage } from "./test-support/fake-storage.ts";
import type { Snapshot } from "../domain/types.ts";

function sampleSnapshot(cursor: number, generation: number): Snapshot {
  return { generation, cursor, lots: [] };
}

describe("localStorage SnapshotStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // Shared behavioural contract (also run against the in-memory fake in
  // src/domain/fakes/snapshot-store.test.ts) — this re-run is what proves
  // the real localStorage-backed implementation honours the exact same
  // semantics under jsdom.
  describeSnapshotStoreContract(() => createLocalStorageSnapshotStore(window.localStorage));

  it("survives reload: a fresh instance constructed over the same storage sees a prior save", async () => {
    const snapshot = sampleSnapshot(40, 2);
    await createLocalStorageSnapshotStore(window.localStorage).save("wb-1", snapshot);

    // A genuinely new instance, not a reference to the one above — proves
    // persistence, not an in-memory cache masquerading as one.
    const reloaded = createLocalStorageSnapshotStore(window.localStorage);
    expect(await reloaded.load("wb-1")).toEqual(snapshot);
  });

  it("keys two workbooks under distinct localStorage keys (no cross-workbook bleed)", async () => {
    const store = createLocalStorageSnapshotStore(window.localStorage);
    await store.save("wb-1", sampleSnapshot(1, 1));
    await store.save("wb-2", sampleSnapshot(2, 1));

    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith("feeder:snapshot:"));
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("load treats corrupt JSON under the key as a cache miss, not a thrown error", async () => {
    window.localStorage.setItem("feeder:snapshot:v1:wb-1", "{ not valid json");
    const store = createLocalStorageSnapshotStore(window.localStorage);
    await expect(store.load("wb-1")).resolves.toBeUndefined();
  });

  it("load treats a storage read failure as a cache miss, not a thrown error", async () => {
    const throwing = createThrowingStorage({
      getItem: () => {
        throw new Error("boom");
      },
    });
    const store = createLocalStorageSnapshotStore(throwing);
    await expect(store.load("wb-1")).resolves.toBeUndefined();
  });

  it("save throws SyncStorageError when the underlying storage write fails (e.g. quota exceeded)", async () => {
    const throwing = createThrowingStorage({
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    });
    const store = createLocalStorageSnapshotStore(throwing);
    await expect(store.save("wb-1", sampleSnapshot(1, 1))).rejects.toBeInstanceOf(SyncStorageError);
  });

  it("clear throws SyncStorageError when the underlying storage removal fails", async () => {
    const throwing = createThrowingStorage({
      removeItem: () => {
        throw new Error("boom");
      },
    });
    const store = createLocalStorageSnapshotStore(throwing);
    await expect(store.clear("wb-1")).rejects.toBeInstanceOf(SyncStorageError);
  });
});
