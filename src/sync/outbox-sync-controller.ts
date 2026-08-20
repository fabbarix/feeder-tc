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
  let flushing = false;

  async function flushNow(): Promise<FlushOutboxResult> {
    if (flushing) {
      // A flush is already in-flight; report the current queue state rather
      // than run two flushes over the same outbox concurrently (which could
      // race an acknowledge against another flush's read of `pending()`).
      const remaining = (await deps.outbox.pending()).length;
      return { flushed: [], remaining };
    }
    flushing = true;
    try {
      const result = await flushOutbox({
        outbox: deps.outbox,
        workbookStore: deps.workbookStore,
        ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
        ...(deps.backoffMs !== undefined ? { backoffMs: deps.backoffMs } : {}),
      });
      deps.onResult?.(result);
      return result;
    } finally {
      flushing = false;
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
