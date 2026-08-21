/**
 * Wires `Outbox` + `flushOutbox` + `ConnectivityMonitor` together: flush
 * automatically when connectivity returns, and expose a manual `flushNow`
 * for a caller that wants to trigger one explicitly (e.g. right after
 * enqueueing a write while nominally online).
 *
 * "Treat a failed flush as a signal too" (WP-17 notes): a flush that
 * exhausts every retry for its first stuck event proved the connection
 * unusable `backoffMs.length + 1` times in a row, even if
 * `navigator.onLine` still claims "online" (the captive-portal case). This
 * controller does not fight that by hammering the connection again
 * immediately — it simply waits for the next explicit `flushNow()` call or
 * the next genuine online transition from the monitor, rather than
 * maintaining a second parallel "am I really online" boolean that could
 * disagree with the monitor it was layered on top of.
 *
 * `flushNow()`'s in-flight guard used to silently DROP a concurrent call —
 * fine for a duplicate request (nothing new to do), but wrong the moment
 * something was enqueued to the outbox AFTER the in-flight flush's own
 * `flushOutbox()` had already taken its `outbox.pending()` snapshot
 * (`flush.ts` reads that list once, not as a live queue). That event was
 * then invisible to the running flush AND to the dropped call, and nothing
 * else in this controller would ever come back for it — a real,
 * reproducible bug (M6 barcode scan, PR #32/#33: scanning the same barcode
 * twice in quick succession calls `flushNow()` twice, and the second
 * event's own purchase could be stranded in the outbox indefinitely,
 * invisible to `InventoryEvents` until some unrelated future flush trigger
 * happened to fire). Fixed below by coalescing: a call that arrives while
 * one is already running schedules exactly one more pass, guaranteed to
 * start only after the current pass returns, so nothing enqueued during
 * the current pass — no matter how many separate calls asked for it — is
 * ever left behind. This never edits or duplicates an `InventoryEvents`
 * row (invariant 1); `flushOutbox`'s own exactly-once dedupe keeps that
 * guarantee regardless of how many passes run.
 */
import type { Outbox, WorkbookStore } from "../domain/contracts.ts";
import type { ConnectivityMonitor } from "./connectivity.ts";
import { flushOutbox, type FlushOutboxResult } from "./flush.ts";

export interface OutboxSyncControllerDeps {
  readonly outbox: Outbox;
  readonly workbookStore: WorkbookStore;
  readonly connectivity: ConnectivityMonitor;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly backoffMs?: readonly number[];
  /** Called after every flush attempt (success or partial failure) — e.g. to drive a "syncing" badge. */
  readonly onResult?: (result: FlushOutboxResult) => void;
}

export interface OutboxSyncController {
  /** Subscribes to connectivity changes (flushing immediately if already online) and returns an unsubscribe function. */
  start(): () => void;
  /** Runs one flush attempt now, regardless of the connectivity monitor's current state. */
  flushNow(): Promise<FlushOutboxResult>;
}

export function createOutboxSyncController(deps: OutboxSyncControllerDeps): OutboxSyncController {
  // `flushing` stays true across an in-flight pass AND any coalesced rerun
  // it schedules — the mutex covers the whole outer `flushNow()` call, not
  // just one `flushOutbox()` invocation, so a THIRD concurrent call arriving
  // during the rerun still coalesces correctly instead of racing it.
  let flushing = false;
  let rerunRequested = false;

  async function runOneFlushPass(): Promise<FlushOutboxResult> {
    const result = await flushOutbox({
      outbox: deps.outbox,
      workbookStore: deps.workbookStore,
      ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
      ...(deps.backoffMs !== undefined ? { backoffMs: deps.backoffMs } : {}),
    });
    deps.onResult?.(result);
    return result;
  }

  async function flushNow(): Promise<FlushOutboxResult> {
    if (flushing) {
      // A flush is already in-flight. Rather than dropping this request —
      // which could strand anything enqueued after the in-flight flush's
      // own `outbox.pending()` snapshot was taken — mark that one more pass
      // is needed once the current one finishes, and report the queue's
      // current state (this call's own return value is otherwise
      // meaningless here; every real caller in this codebase awaits
      // `flushNow()` only to enqueue-then-fire-and-forget, never to inspect
      // this particular return value — the coalesced pass's `onResult`
      // still reports the real outcome once it runs).
      rerunRequested = true;
      const remaining = (await deps.outbox.pending()).length;
      return { flushed: [], remaining };
    }
    flushing = true;
    try {
      // Only THIS call's own pass belongs in its return value — a caller
      // that awaits `flushNow()` to see what it personally flushed (the
      // pre-existing "does not run two flushes concurrently" test does
      // exactly this) must get that pass's real result, not a later
      // coalesced rerun's. The rerun below is deliberately a separate,
      // un-awaited call.
      return await runOneFlushPass();
    } finally {
      flushing = false;
      if (rerunRequested) {
        // Something was enqueued while the pass above was running (or while
        // a concurrent caller was waiting for it) — run exactly one more
        // pass to pick it up. `flushing` is already false here, so this
        // recurses as a normal, independent flushNow() call; its result
        // reaches `onResult` like any other, just not this call's return
        // value. No `await` runs between clearing `flushing` and this call,
        // so nothing else can interleave and start its own pass first.
        rerunRequested = false;
        void flushNow();
      }
    }
  }

  function start(): () => void {
    if (deps.connectivity.isOnline()) {
      void flushNow();
    }
    return deps.connectivity.subscribe((online) => {
      if (online) void flushNow();
    });
  }

  return { start, flushNow };
}
