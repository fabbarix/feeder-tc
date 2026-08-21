import { beforeEach, describe, expect, it } from "vitest";
import { createLocalStoragePlannerStateStore } from "./planner-state-store.ts";
import { SyncStorageError } from "./storage.ts";
import { createThrowingStorage } from "./test-support/fake-storage.ts";
import { makeRecipeId } from "../domain/types.ts";
import type { StaplePlanState } from "../domain/planner/generator.ts";

function sampleState(): StaplePlanState {
  const queue = [makeRecipeId("staple-1"), makeRecipeId("staple-2")];
  const rotation = { queue, cycleMembers: queue };
  const empty = { queue: [], cycleMembers: [] };
  return { breakfast: empty, lunch: empty, dinner: rotation, snack: empty };
}

describe("localStorage PlannerStateStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns undefined when nothing has been saved", async () => {
    const store = createLocalStoragePlannerStateStore(window.localStorage);
    await expect(store.load("wb-1")).resolves.toBeUndefined();
  });

  it("survives reload: a fresh instance constructed over the same storage sees a prior save", async () => {
    const state = sampleState();
    await createLocalStoragePlannerStateStore(window.localStorage).save("wb-1", state);

    const reloaded = createLocalStoragePlannerStateStore(window.localStorage);
    await expect(reloaded.load("wb-1")).resolves.toEqual(state);
  });

  it("keys two workbooks under distinct localStorage keys (no cross-workbook bleed)", async () => {
    const store = createLocalStoragePlannerStateStore(window.localStorage);
    await store.save("wb-1", sampleState());
    await store.save("wb-2", sampleState());

    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith("feeder:planner-state:"));
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("clear removes only that workbook's state", async () => {
    const store = createLocalStoragePlannerStateStore(window.localStorage);
    await store.save("wb-1", sampleState());
    await store.save("wb-2", sampleState());
    await store.clear("wb-1");
    await expect(store.load("wb-1")).resolves.toBeUndefined();
    await expect(store.load("wb-2")).resolves.toEqual(sampleState());
  });

  it("load treats corrupt JSON under the key as absent, not a thrown error", async () => {
    window.localStorage.setItem("feeder:planner-state:v1:wb-1", "{ not valid json");
    const store = createLocalStoragePlannerStateStore(window.localStorage);
    await expect(store.load("wb-1")).resolves.toBeUndefined();
  });

  it("load treats a storage read failure as absent, not a thrown error", async () => {
    const throwing = createThrowingStorage({
      getItem: () => {
        throw new Error("boom");
      },
    });
    const store = createLocalStoragePlannerStateStore(throwing);
    await expect(store.load("wb-1")).resolves.toBeUndefined();
  });

  it("save throws SyncStorageError when the underlying storage write fails", async () => {
    const throwing = createThrowingStorage({
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    });
    const store = createLocalStoragePlannerStateStore(throwing);
    await expect(store.save("wb-1", sampleState())).rejects.toBeInstanceOf(SyncStorageError);
  });

  it("clear throws SyncStorageError when the underlying storage removal fails", async () => {
    const throwing = createThrowingStorage({
      removeItem: () => {
        throw new Error("boom");
      },
    });
    const store = createLocalStoragePlannerStateStore(throwing);
    await expect(store.clear("wb-1")).rejects.toBeInstanceOf(SyncStorageError);
  });
});
