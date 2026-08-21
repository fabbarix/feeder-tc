/**
 * One `Outbox` + one `OutboxSyncController` per workbook, shared app-wide
 * (fix for the double-append data-integrity bug: `App.tsx` and each of the
 * four route hooks — pantry, scan, plan, shopping — used to independently
 * call `createLocalStorageOutbox(workbookId)` +
 * `createBrowserConnectivityMonitor()` + `createOutboxSyncController(...)`
 * for the SAME workbook. `createLocalStorageOutbox` is a stateless wrapper
 * over one localStorage key per workbook (see outbox.ts's header comment —
 * "No in-memory mirror"), so multiple `Outbox` instances over the same
 * workbook agree on the queue's contents. But every one of those controller
 * instances is independently "live": it subscribes to connectivity on its
 * own and reacts to the same online transition. With App's controller
 * always mounted, ANY route hook that also builds one means two live
 * controllers for the entire time that route is open — not a rare race, the
 * steady state. Both wake on the same reconnect, both read the same
 * `outbox.pending()` list, both call `workbookStore.inventoryEvents.append`
 * for the same event, and — since `flush.ts`'s exactly-once dedupe used to
 * run only on a FAILED append's retry — both first attempts can succeed,
 * doubling the row.
 *
 * The fix: this module is the single place that constructs the outbox +
 * controller pair for a given workbook. Callers `acquire()` a handle instead
 * of constructing their own; the first `acquire()` for a workbookId builds
 * the pair and starts the controller, every later `acquire()` for the same
 * workbookId gets the SAME instances back, and the underlying controller
 * only stops (unsubscribing from connectivity) once every acquirer has
 * `release()`d — so switching the active workbook, or a route unmounting
 * while another is still open, can never leak a stale subscription or leave
 * two controllers alive for one workbook.
 *
 * A module-level registry (rather than threading a shared instance through
 * React context) was chosen deliberately: every one of the five call sites
 * already independently builds this trio inline in a boot effect, so
 * `acquire`/`release` is a drop-in replacement for that exact code with no
 * change to each hook's lifecycle shape (still: build in the effect, tear
 * down in its cleanup). It also keeps this fix entirely inside `src/sync/**`
 * plus the five call sites this work package owns, rather than also
 * reaching into `workbook-context.ts` (outside that ownership list) to grow
 * `WorkbookContextValue`. Ref-counting (not a bare cache) is what makes
 * teardown correct regardless of mount/unmount order between App and
 * whichever route happens to be open.
 */
import type { Outbox, WorkbookStore } from "../domain/contracts.ts";
import { createLocalStorageOutbox } from "./outbox.ts";
import { createBrowserConnectivityMonitor, type ConnectivityMonitor } from "./connectivity.ts";
import { createOutboxSyncController, type OutboxSyncController } from "./outbox-sync-controller.ts";
import type { FlushOutboxResult } from "./flush.ts";

export interface AcquireSharedOutboxSyncParams {
  readonly workbookId: string;
  readonly workbookStore: WorkbookStore;
  /** Only consulted by the FIRST acquire() for a given workbookId — see module doc comment. Defaults to the real browser monitor. */
  readonly connectivity?: ConnectivityMonitor;
  /** Only consulted by the FIRST acquire() for a given workbookId. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Only consulted by the FIRST acquire() for a given workbookId. */
  readonly backoffMs?: readonly number[];
  /** Called after every flush this controller runs, for as long as this handle hasn't been released — fanned out to every current acquirer, not just whichever one triggered the flush (a flush drains the whole shared queue, not just one route's events). */
  readonly onResult?: (result: FlushOutboxResult) => void;
}

export interface SharedOutboxSync {
  readonly outbox: Outbox;
  readonly controller: OutboxSyncController;
  /**
   * Releases this handle's share of the underlying controller. Once every
   * handle for a workbookId has released, the controller's connectivity
   * subscription is torn down and the registry entry is dropped — the next
   * `acquire()` for that workbookId starts fresh. Idempotent: calling twice
   * is a no-op the second time.
   */
  readonly release: () => void;
}

interface RegistryEntry {
  readonly outbox: Outbox;
  readonly controller: OutboxSyncController;
  readonly stop: () => void;
  readonly listeners: Set<(result: FlushOutboxResult) => void>;
  refCount: number;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Acquires the shared `Outbox` + `OutboxSyncController` for one workbook,
 * creating and starting them on the first call for that workbookId. See
 * module doc comment for why this exists and why the shape is
 * acquire/release rather than a bare memoized getter.
 */
export function acquireSharedOutboxSync(params: AcquireSharedOutboxSyncParams): SharedOutboxSync {
  let entry = registry.get(params.workbookId);
  if (!entry) {
    const connectivity = params.connectivity ?? createBrowserConnectivityMonitor();
    const outbox = createLocalStorageOutbox(params.workbookId);
    const listeners = new Set<(result: FlushOutboxResult) => void>();
    const controller = createOutboxSyncController({
      outbox,
      workbookStore: params.workbookStore,
      connectivity,
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
      ...(params.backoffMs !== undefined ? { backoffMs: params.backoffMs } : {}),
      onResult: (result) => {
        for (const listener of listeners) listener(result);
      },
    });
    const stop = controller.start();
    entry = { outbox, controller, stop, listeners, refCount: 0 };
    registry.set(params.workbookId, entry);
  }

  const liveEntry = entry;
  liveEntry.refCount += 1;
  if (params.onResult) liveEntry.listeners.add(params.onResult);

  let released = false;
  return {
    outbox: liveEntry.outbox,
    controller: liveEntry.controller,
    release: () => {
      if (released) return;
      released = true;
      if (params.onResult) liveEntry.listeners.delete(params.onResult);
      liveEntry.refCount -= 1;
      if (liveEntry.refCount <= 0) {
        liveEntry.stop();
        // Only drop the registry entry if nothing re-acquired it in the
        // meantime (defensive; refCount<=0 already implies this in every
        // real call pattern, since a new acquire() would have bumped it
        // back above 0 before this release() runs — same-tick React
        // effect teardown/setup never interleaves with this synchronous
        // block).
        if (registry.get(params.workbookId) === liveEntry) {
          registry.delete(params.workbookId);
        }
      }
    },
  };
}

/** Test-only: clears every registry entry WITHOUT calling `stop()` on any of them. Only safe when a test has already asserted on / manually unsubscribed its own monitors — real callers never need this. */
export function __resetSharedOutboxSyncRegistryForTests(): void {
  registry.clear();
}
