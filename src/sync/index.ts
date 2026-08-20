// Sync layer: localStorage SnapshotStore, incremental sync via cursor +
// generation, the append-only write Outbox, connectivity detection, and the
// last-write-wins refresh-before-edit helper for plain-row sheets. See
// IMPLEMENTATION_PLAN.md WP-17.
export { createLocalStorageSnapshotStore } from "./snapshot-store.ts";
export { createLocalStorageOutbox } from "./outbox.ts";
export { syncSnapshot, previewSnapshotWithPending, type SyncDeps } from "./sync.ts";
export {
  flushOutbox,
  type FlushOutboxDeps,
  type FlushOutboxResult,
  type FlushOutboxFailure,
} from "./flush.ts";
export {
  createBrowserConnectivityMonitor,
  createManualConnectivityMonitor,
  type ConnectivityMonitor,
  type ConnectivityEventTarget,
  type ManualConnectivityMonitor,
} from "./connectivity.ts";
export {
  createOutboxSyncController,
  type OutboxSyncController,
  type OutboxSyncControllerDeps,
} from "./outbox-sync-controller.ts";
export {
  refreshBeforeEdit,
  RefreshBeforeEditNotFoundError,
  type RefreshBeforeEditDeps,
} from "./refresh-before-edit.ts";
export { SyncStorageError } from "./storage.ts";
