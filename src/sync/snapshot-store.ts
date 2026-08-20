/**
 * localStorage-backed SnapshotStore (WP-17). Per-workbook keyed, so a
 * household with several open workbooks never has one workbook's cached
 * lots bleed into another's key — see `keyFor`.
 *
 * Storage-failure policy (invariant 5, HANDOVER §4: the snapshot is only a
 * cache, always reconstructible by folding InventoryEvents from cursor 0):
 *
 * - `load` treats a storage read failure OR a corrupted/foreign value under
 *   the key as a cache miss (`undefined`, logged via `console.warn`), never
 *   thrown. The caller's normal reaction to "no cached snapshot" is a full
 *   re-read, which is always safe and always correct — there is no reason
 *   to surface a distinct error path for "the cache is unreadable" when
 *   "the cache is absent" already has a safe, well-trodden handler.
 * - `save`/`clear` failures ARE thrown, as `SyncStorageError`. Unlike a read
 *   failure, a write failure that was silently swallowed would leave later
 *   `load` calls returning stale data while the caller believes the cache
 *   is current. Callers that consider caching a nice-to-have (see
 *   `sync.ts`'s `syncSnapshot`) catch and log; nothing downstream of the
 *   sync layer needs the cache write to succeed in order to stay correct.
 */
import type { SnapshotStore } from "../domain/contracts.ts";
import type { Snapshot } from "../domain/types.ts";
import { parseJson, readRaw, removeRaw, writeRaw } from "./storage.ts";

const KEY_PREFIX = "feeder:snapshot:v1:";

function keyFor(workbookId: string): string {
  return `${KEY_PREFIX}${workbookId}`;
}

export function createLocalStorageSnapshotStore(storage: Storage = window.localStorage): SnapshotStore {
  return {
    async load(workbookId) {
      const key = keyFor(workbookId);
      let raw: string | null;
      try {
        raw = readRaw(storage, key);
      } catch (err) {
        console.warn("SnapshotStore.load: storage read failed, treating as a cache miss", err);
        return undefined;
      }
      if (raw === null) return undefined;
      try {
        return parseJson<Snapshot>(raw, key);
      } catch (err) {
        console.warn("SnapshotStore.load: corrupt cached snapshot, treating as a cache miss", err);
        return undefined;
      }
    },
    async save(workbookId, snapshot) {
      writeRaw(storage, keyFor(workbookId), JSON.stringify(snapshot));
    },
    async clear(workbookId) {
      removeRaw(storage, keyFor(workbookId));
    },
  };
}
