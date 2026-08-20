/**
 * Cursor + generation reconciliation — WP-12, protecting HANDOVER.md §4
 * invariant 2 ("Cursor safety"): a client whose cached generation mismatches
 * `Meta` must discard its snapshot and re-read fully.
 *
 * `contracts.ts`'s `ApplyNewEvents` type is frozen at exactly
 * `(snapshot, events, meta) => SyncOutcome` — no room for a catalog
 * parameter, even though folding a `purchase` event needs one. So this
 * module exports a factory, `createApplyNewEvents(catalog, options)`, that
 * closes over the catalog once and returns a function assignable to
 * `ApplyNewEvents` exactly. WP-17 builds this once (catalog rarely changes
 * within a session) and calls the returned function on every sync tick.
 */
import { foldInventoryEvents, type FoldOptions } from "./fold.ts";
import type { ApplyNewEvents, SyncOutcome } from "../contracts.ts";
import type { Ingredient, IngredientId, InventoryEvent, Meta, Snapshot } from "../types.ts";

/**
 * Returns a function matching `contracts.ts`'s `ApplyNewEvents` type.
 *
 * Precondition on every call: `events` must be exactly the InventoryEvents
 * rows in true sheet order starting immediately after `snapshot.cursor`
 * (i.e. what `WorkbookStore.inventoryEvents.readFrom(snapshot.cursor)`
 * returns) — the new cursor is derived as `snapshot.cursor + events.length`
 * because the frozen signature has no separate `nextCursor` parameter to
 * carry that number explicitly. A gap or reordering in `events` silently
 * breaks cursor arithmetic; it is the caller's job to uphold this.
 */
export function createApplyNewEvents(
  catalog: ReadonlyMap<IngredientId, Ingredient>,
  options: FoldOptions = {},
): ApplyNewEvents {
  return function applyNewEvents(
    snapshot: Snapshot,
    events: readonly InventoryEvent[],
    meta: Meta,
  ): SyncOutcome {
    if (snapshot.generation !== meta.generation) {
      return {
        kind: "reload-required",
        reason:
          `snapshot generation ${snapshot.generation} does not match Meta generation ${meta.generation}; ` +
          "discard the cached snapshot and re-read the workbook fully",
      };
    }

    const { lots } = foldInventoryEvents(snapshot.lots, events, catalog, options);

    return {
      kind: "applied",
      snapshot: {
        generation: meta.generation,
        cursor: snapshot.cursor + events.length,
        lots,
      },
    };
  };
}
