/**
 * Shared SnapshotStore behavioural contract. WP-17 re-runs this exact suite
 * against the real localStorage-backed implementation (in jsdom).
 */
import { describe, expect, it } from "vitest";
import type { SnapshotStore } from "../contracts.ts";
import { makeIngredientId, makeIsoDate, makeLotId, makeQuantity, type Snapshot } from "../types.ts";

function snapshot(cursor: number, generation: number): Snapshot {
  return {
    generation,
    cursor,
    lots: [
      {
        id: makeLotId("lot-1"),
        ingredientId: makeIngredientId("rice"),
        quantity: makeQuantity(700, "g"),
        purchaseDate: makeIsoDate("2026-03-01"),
        location: "pantry",
        expiry: makeIsoDate("2028-03-01"),
        expiryOverridden: false,
      },
    ],
  };
}

export function describeSnapshotStoreContract(makeSubject: () => SnapshotStore): void {
  describe("SnapshotStore contract", () => {
    it("load returns undefined when nothing has been saved for a workbook", async () => {
      const store = makeSubject();
      expect(await store.load("wb-1")).toBeUndefined();
    });

    it("save then load round-trips the snapshot", async () => {
      const store = makeSubject();
      await store.save("wb-1", snapshot(40, 1));
      expect(await store.load("wb-1")).toEqual(snapshot(40, 1));
    });

    it("is keyed per workbook: saving one workbook does not affect another", async () => {
      const store = makeSubject();
      await store.save("wb-1", snapshot(40, 1));
      expect(await store.load("wb-2")).toBeUndefined();
    });

    it("clear removes only that workbook's snapshot", async () => {
      const store = makeSubject();
      await store.save("wb-1", snapshot(40, 1));
      await store.save("wb-2", snapshot(10, 1));
      await store.clear("wb-1");
      expect(await store.load("wb-1")).toBeUndefined();
      expect(await store.load("wb-2")).toEqual(snapshot(10, 1));
    });

    it("save overwrites a previously saved snapshot for the same workbook", async () => {
      const store = makeSubject();
      await store.save("wb-1", snapshot(40, 1));
      await store.save("wb-1", snapshot(125, 2));
      expect(await store.load("wb-1")).toEqual(snapshot(125, 2));
    });
  });
}
