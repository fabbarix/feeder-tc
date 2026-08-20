/**
 * Shared Outbox behavioural contract. WP-17 re-runs this exact suite against
 * its real persisted implementation. Covers the two guarantees invariant 9
 * and WP-17's BDD ("Flush retry does not duplicate events") depend on: FIFO
 * order and idempotence by EventId.
 */
import { describe, expect, it } from "vitest";
import type { Outbox } from "../contracts.ts";
import { makeEventId, makeIngredientId, makeIsoTimestamp, makeQuantity, type InventoryEvent } from "../types.ts";

function useEvent(id: string): InventoryEvent {
  return {
    type: "use",
    id: makeEventId(id),
    timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    ingredientId: makeIngredientId("rice"),
    quantity: makeQuantity(100, "g"),
  };
}

export function describeOutboxContract(makeSubject: () => Outbox): void {
  describe("Outbox contract", () => {
    it("starts empty", async () => {
      const outbox = makeSubject();
      expect(await outbox.pending()).toEqual([]);
    });

    it("enqueue adds entries in FIFO order", async () => {
      const outbox = makeSubject();
      await outbox.enqueue(useEvent("evt-1"));
      await outbox.enqueue(useEvent("evt-2"));
      expect(await outbox.pending()).toEqual([useEvent("evt-1"), useEvent("evt-2")]);
    });

    it("enqueueing the same event id twice keeps a single entry (idempotent)", async () => {
      const outbox = makeSubject();
      await outbox.enqueue(useEvent("evt-1"));
      await outbox.enqueue(useEvent("evt-1"));
      expect(await outbox.pending()).toEqual([useEvent("evt-1")]);
    });

    it("acknowledge removes the matching entry", async () => {
      const outbox = makeSubject();
      await outbox.enqueue(useEvent("evt-1"));
      await outbox.enqueue(useEvent("evt-2"));
      await outbox.acknowledge(makeEventId("evt-1"));
      expect(await outbox.pending()).toEqual([useEvent("evt-2")]);
    });

    it("acknowledging an id that is not pending is a no-op", async () => {
      const outbox = makeSubject();
      await outbox.enqueue(useEvent("evt-1"));
      await outbox.acknowledge(makeEventId("evt-does-not-exist"));
      expect(await outbox.pending()).toEqual([useEvent("evt-1")]);
    });

    it("clear empties the queue", async () => {
      const outbox = makeSubject();
      await outbox.enqueue(useEvent("evt-1"));
      await outbox.clear();
      expect(await outbox.pending()).toEqual([]);
    });
  });
}
