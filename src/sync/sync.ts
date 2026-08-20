/**
 * Incremental sync orchestration (WP-17), built on WP-12's `applyNewEvents`
 * (`ApplyNewEvents`, injected — this module never reimplements the fold,
 * per the work package brief).
 *
 * Cursor safety (invariant 2, HANDOVER §4): if there is no cached snapshot,
 * or its `generation` doesn't match `Meta.generation`, the cache is
 * discarded (`SnapshotStore.clear`) and a full re-read (cursor 0) happens
 * instead of folding new events onto a snapshot a compaction may have
 * invalidated. `applyNewEvents` returning `reload-required` mid-fold is
 * handled the same way defensively — see `fullReload` — even though a
 * generation match at the top of `syncSnapshot` should already have ruled
 * that out; the extra check costs nothing and means a caller never has to
 * reason about a third, half-handled outcome.
 */
import type { ApplyNewEvents, SnapshotStore, WorkbookStore } from "../domain/contracts.ts";
import type { InventoryEvent, Meta, Snapshot } from "../domain/types.ts";

export interface SyncDeps {
  readonly workbookStore: WorkbookStore;
  readonly snapshotStore: SnapshotStore;
  readonly applyNewEvents: ApplyNewEvents;
}

function emptyBase(meta: Meta): Snapshot {
  return { generation: meta.generation, cursor: 0, lots: [] };
}

async function trySave(store: SnapshotStore, workbookId: string, snapshot: Snapshot): Promise<void> {
  try {
    await store.save(workbookId, snapshot);
  } catch (err) {
    // Cache-only (invariant 5): a failed persist doesn't invalidate the
    // snapshot this call is about to return, it only means the *next* call
    // pays for a full re-read instead of an incremental one.
    console.warn("syncSnapshot: failed to persist snapshot cache (non-fatal, cache only)", err);
  }
}

async function tryClear(store: SnapshotStore, workbookId: string): Promise<void> {
  try {
    await store.clear(workbookId);
  } catch (err) {
    console.warn("syncSnapshot: failed to clear stale snapshot cache", err);
  }
}

async function fullReload(deps: SyncDeps, workbookId: string): Promise<Snapshot> {
  await tryClear(deps.snapshotStore, workbookId);
  const meta = await deps.workbookStore.meta.read();
  const page = await deps.workbookStore.inventoryEvents.readFrom(0);
  const outcome = deps.applyNewEvents(emptyBase(meta), page.rows, meta);
  if (outcome.kind === "reload-required") {
    // A full re-read from cursor 0 against fresh Meta still can't fold —
    // that's not a cursor/generation problem this layer can resolve by
    // retrying, so surface it rather than looping forever.
    throw new Error(`syncSnapshot: reload-required persisted after a full re-read from cursor 0 (${outcome.reason})`);
  }
  await trySave(deps.snapshotStore, workbookId, outcome.snapshot);
  return outcome.snapshot;
}

export async function syncSnapshot(deps: SyncDeps, workbookId: string): Promise<Snapshot> {
  const meta = await deps.workbookStore.meta.read();
  const cached = await deps.snapshotStore.load(workbookId);

  let base: Snapshot;
  if (cached === undefined || cached.generation !== meta.generation) {
    if (cached !== undefined) {
      // Invariant 2: cached generation is stale — discard rather than fold
      // new events onto a snapshot a compaction may have invalidated.
      await tryClear(deps.snapshotStore, workbookId);
    }
    base = emptyBase(meta);
  } else {
    base = cached;
  }

  const page = await deps.workbookStore.inventoryEvents.readFrom(base.cursor);
  if (page.rows.length === 0) {
    if (base !== cached) await trySave(deps.snapshotStore, workbookId, base);
    return base;
  }

  const outcome = deps.applyNewEvents(base, page.rows, meta);
  if (outcome.kind === "reload-required") {
    return fullReload(deps, workbookId);
  }

  await trySave(deps.snapshotStore, workbookId, outcome.snapshot);
  return outcome.snapshot;
}

/**
 * Optimistic read model for the UI: the confirmed snapshot with pending
 * outbox events folded on top for display, WITHOUT advancing cursor or
 * generation — those pending events are not yet real sheet rows, so
 * persisting a cursor that assumed they were would corrupt the next
 * incremental sync. Reuses `applyNewEvents` purely for its `lots` output
 * (never reimplements the fold); the returned Snapshot's `cursor`/
 * `generation` are always the confirmed ones. This is what makes "the
 * local snapshot reflects both [pending] events" true (WP-17 BDD) without
 * ever writing a speculative cursor to the SnapshotStore.
 *
 * If folding the pending events would itself report `reload-required`
 * (only possible with stale `meta`), the confirmed snapshot is returned
 * unchanged — a real reload is `syncSnapshot`'s job, not this preview's.
 */
export function previewSnapshotWithPending(
  confirmed: Snapshot,
  pending: readonly InventoryEvent[],
  meta: Meta,
  applyNewEvents: ApplyNewEvents,
): Snapshot {
  if (pending.length === 0) return confirmed;
  const outcome = applyNewEvents(confirmed, pending, meta);
  if (outcome.kind === "reload-required") return confirmed;
  return { ...outcome.snapshot, cursor: confirmed.cursor, generation: confirmed.generation };
}
