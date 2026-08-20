/**
 * Last-write-wins "refresh before edit" for plain-row sheets — recipes,
 * ingredients, plan slots, shopping items, settings. Per HANDOVER's
 * decision register ("Concurrency: Append-mostly + last-write-wins; no
 * locking, no version columns"), this deliberately does NOT detect or
 * resolve conflicts. Its only job is making sure an edit is computed from
 * the latest known row (so a partial-field edit doesn't blindly clobber a
 * field someone else changed a moment ago) before writing it back;
 * whichever `upsert` call physically lands last on the sheet still simply
 * wins, exactly as it would with no helper at all.
 *
 * NOT for InventoryEvents: those are append-only and go through the
 * Outbox (invariant 9), never through this path — see `outbox.ts`.
 */
import type { DecodeResult } from "../domain/contracts.ts";

export interface RefreshBeforeEditDeps<T> {
  readonly readAll: () => Promise<DecodeResult<T>>;
  readonly upsert: (entity: T) => Promise<void>;
  /** Locates the row being edited among the freshly-read rows, e.g. `(rows) => rows.find((r) => r.id === id)`. */
  readonly find: (rows: readonly T[]) => T | undefined;
  /** Pure transform applied to the freshly-read row. */
  readonly edit: (latest: T) => T;
}

export class RefreshBeforeEditNotFoundError extends Error {
  constructor() {
    super("refreshBeforeEdit: entity not found on refresh (it may have been deleted by another client)");
    this.name = "RefreshBeforeEditNotFoundError";
  }
}

export async function refreshBeforeEdit<T>(deps: RefreshBeforeEditDeps<T>): Promise<T> {
  const { rows } = await deps.readAll();
  const current = deps.find(rows);
  if (current === undefined) {
    throw new RefreshBeforeEditNotFoundError();
  }
  const next = deps.edit(current);
  await deps.upsert(next);
  return next;
}
