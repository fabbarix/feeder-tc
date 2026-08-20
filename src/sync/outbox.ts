/**
 * localStorage-backed Outbox (WP-17), one instance per workbook. Per
 * invariant 9, this queue holds only `InventoryEvent`s — plain-row edits
 * (recipes, settings, plan slots, shopping items) never go through it, see
 * `refresh-before-edit.ts` instead.
 *
 * No in-memory mirror: every method re-reads the persisted queue from
 * `storage`. Two instances opened over the same storage (a fresh instance
 * constructed after "reload") therefore always agree — that is what
 * "outbox survives reload" means in WP-17's success criteria, and it also
 * means a failed write is never masked by an in-memory copy that has
 * quietly drifted from what actually persisted.
 *
 * Storage-failure policy (invariant 9: offline writes must never be
 * silently lost) — deliberately the OPPOSITE of SnapshotStore's policy:
 *
 * - A read failure (storage throws, or the stored JSON is corrupt) is
 *   thrown, not treated as an empty queue. Unlike the snapshot cache, "I
 *   can't read the outbox" and "the outbox is empty" are not
 *   interchangeable: silently treating the former as the latter is exactly
 *   how an offline write gets lost without anyone finding out. The caller
 *   (UI layer) is expected to surface this loudly rather than proceed as if
 *   nothing were queued.
 * - A write failure (enqueue/acknowledge/clear) is thrown as
 *   `SyncStorageError` too, and — critically — thrown BEFORE the operation
 *   is considered to have happened: `enqueue` only reports success once
 *   `setItem` has actually returned, so a caller that doesn't see an
 *   exception can trust the event is durably queued.
 */
import type { Outbox } from "../domain/contracts.ts";
import type { EventId, InventoryEvent } from "../domain/types.ts";
import { parseJson, readRaw, writeRaw } from "./storage.ts";

const KEY_PREFIX = "feeder:outbox:v1:";

function keyFor(workbookId: string): string {
  return `${KEY_PREFIX}${workbookId}`;
}

function readQueue(storage: Storage, key: string): InventoryEvent[] {
  const raw = readRaw(storage, key);
  if (raw === null) return [];
  return parseJson<InventoryEvent[]>(raw, key);
}

function writeQueue(storage: Storage, key: string, queue: readonly InventoryEvent[]): void {
  writeRaw(storage, key, JSON.stringify(queue));
}

export function createLocalStorageOutbox(workbookId: string, storage: Storage = window.localStorage): Outbox {
  const key = keyFor(workbookId);
  return {
    async enqueue(event) {
      const queue = readQueue(storage, key);
      if (queue.some((existing) => existing.id === event.id)) return;
      writeQueue(storage, key, [...queue, event]);
    },
    async pending() {
      return readQueue(storage, key);
    },
    async acknowledge(eventId: EventId) {
      const queue = readQueue(storage, key);
      const next = queue.filter((event) => event.id !== eventId);
      if (next.length === queue.length) return;
      writeQueue(storage, key, next);
    },
    async clear() {
      writeQueue(storage, key, []);
    },
  };
}
