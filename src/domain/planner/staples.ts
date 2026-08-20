/**
 * Cross-week staple round-robin — WP-13.
 *
 * DESIGN.md §2 "Planning": "more staples than slots -> round-robin across
 * weeks." That needs generation N to know what generation N-1 already
 * placed, and the WP brief is explicit that this must be "an explicit input
 * rather than hidden state" — so `StapleRotationState` is a plain,
 * serialisable value the caller threads through: `advanceStaples` takes the
 * previous state and returns the next one alongside this call's placements,
 * rather than the module remembering anything itself. Persisting that value
 * between weeks (in Settings, localStorage, wherever) is the caller's job —
 * this module stays pure.
 *
 * Model: a FIFO `queue` of staple ids not yet placed in the current cycle,
 * plus `cycleMembers`, the staple id set the current cycle started with.
 * Each call:
 *   1. drops ids no longer staple from both lists;
 *   2. treats any id that is staple now but wasn't a `cycleMembers` id as a
 *      genuine newcomer and appends it to both (so it gets a turn in the
 *      cycle already in progress, rather than waiting for the next reset);
 *   3. if the queue is empty and there are staples to place, starts a fresh
 *      cycle (queue = cycleMembers = every current staple id);
 *   4. dequeues up to `slotsCount` ids from the front.
 *
 * "No staple appears twice before all have appeared once" falls out of step
 * 4 alone: an id leaves the queue the moment it is placed and cannot return
 * until a fresh cycle refills the queue with the *entire* staple set at
 * once, which only happens once the queue has been fully drained.
 */
import type { RecipeId } from "../types.ts";

export interface StapleRotationState {
  /** Staple ids not yet placed in the current cycle, in placement order. */
  readonly queue: readonly RecipeId[];
  /** The staple id set the current cycle started with (detects genuine newcomers vs. already-placed ids). */
  readonly cycleMembers: readonly RecipeId[];
}

/** The state to pass in for a meal tag that has never been generated before. */
export const initialStapleRotationState: StapleRotationState = { queue: [], cycleMembers: [] };

export interface StapleBatch {
  /** Staple ids to place this call, in slot order. Never longer than `slotsCount`. */
  readonly placed: readonly RecipeId[];
  readonly nextState: StapleRotationState;
}

/**
 * Advances the rotation by one generation. `stapleIds` is the *current*
 * staple set for one meal tag, in a stable order (callers should pass the
 * same ordering every time, e.g. recipe list order, so cycles are
 * reproducible); `slotsCount` is how many of that meal tag's slots are open
 * for staple placement this week (already excluding pinned slots).
 */
export function advanceStaples(
  stapleIds: readonly RecipeId[],
  state: StapleRotationState,
  slotsCount: number,
): StapleBatch {
  const currentSet = new Set(stapleIds);
  const memberSet = new Set(state.cycleMembers);
  const newcomers = stapleIds.filter((id) => !memberSet.has(id));

  let queue = [...state.queue.filter((id) => currentSet.has(id)), ...newcomers];
  const cycleMembers = [...state.cycleMembers.filter((id) => currentSet.has(id)), ...newcomers];

  if (queue.length === 0 && stapleIds.length > 0) {
    // Previous cycle fully drained (or this is the very first call with no
    // newcomers path having filled it already) — start a fresh cycle.
    queue = [...stapleIds];
  }

  const placedCount = Math.max(0, Math.min(slotsCount, queue.length));
  const placed = queue.slice(0, placedCount);
  const nextQueue = queue.slice(placedCount);

  return {
    placed,
    nextState: { queue: nextQueue, cycleMembers },
  };
}
