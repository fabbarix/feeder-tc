/**
 * In-memory Outbox fake. Enforces the two behavioural guarantees the real
 * implementation (WP-17) must also provide: FIFO order, and idempotent
 * enqueue/acknowledge by EventId (invariant 9 / design requirement 11).
 */
import type { Outbox } from "../contracts.ts";
import type { InventoryEvent } from "../types.ts";

export function createFakeOutbox(): Outbox {
  const queue: InventoryEvent[] = [];
  return {
    async enqueue(event) {
      if (!queue.some((existing) => existing.id === event.id)) {
        queue.push(event);
      }
    },
    async pending() {
      return [...queue];
    },
    async acknowledge(eventId) {
      const index = queue.findIndex((event) => event.id === eventId);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    },
    async clear() {
      queue.length = 0;
    },
  };
}
