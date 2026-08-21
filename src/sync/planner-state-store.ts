/**
 * localStorage-backed store for the planner's cross-week staple rotation
 * state (WP-22, `StaplePlanState` from `src/domain/planner/generator.ts`).
 *
 * WP-13's generator is explicit that this value is "an explicit input
 * rather than hidden state" and that persisting it between weeks is the
 * caller's job (see `staples.ts`'s header comment) — this module is that
 * job. Per-workbook keyed, same shape and failure policy as
 * `snapshot-store.ts` (WP-17):
 *
 * - `load` treats a storage read failure OR a corrupted/foreign value under
 *   the key as "no cached state" (`undefined`), never thrown — the normal
 *   reaction (fall back to `initialStaplePlanState`) is always safe: it
 *   just restarts the round-robin cycle, which is a minor UX hiccup, not a
 *   correctness problem (see the module doc comment on why this lives in
 *   localStorage rather than the workbook — `Settings` is frozen and this
 *   value is a scheduling hint, not data the household edits or needs to
 *   see).
 * - `save`/`clear` failures ARE thrown, as `SyncStorageError` — same
 *   reasoning as `snapshot-store.ts`: a swallowed write failure would leave
 *   `load` silently returning stale state later.
 */
import type { StaplePlanState } from "../domain/planner/generator.ts";
import { parseJson, readRaw, removeRaw, writeRaw } from "./storage.ts";

const KEY_PREFIX = "feeder:planner-state:v1:";

function keyFor(workbookId: string): string {
  return `${KEY_PREFIX}${workbookId}`;
}

export interface PlannerStateStore {
  load(workbookId: string): Promise<StaplePlanState | undefined>;
  save(workbookId: string, state: StaplePlanState): Promise<void>;
  clear(workbookId: string): Promise<void>;
}

export function createLocalStoragePlannerStateStore(storage: Storage = window.localStorage): PlannerStateStore {
  return {
    async load(workbookId) {
      const key = keyFor(workbookId);
      let raw: string | null;
      try {
        raw = readRaw(storage, key);
      } catch (err) {
        console.warn("PlannerStateStore.load: storage read failed, treating as absent", err);
        return undefined;
      }
      if (raw === null) return undefined;
      try {
        return parseJson<StaplePlanState>(raw, key);
      } catch (err) {
        console.warn("PlannerStateStore.load: corrupt cached state, treating as absent", err);
        return undefined;
      }
    },
    async save(workbookId, state) {
      writeRaw(storage, keyFor(workbookId), JSON.stringify(state));
    },
    async clear(workbookId) {
      removeRaw(storage, keyFor(workbookId));
    },
  };
}
