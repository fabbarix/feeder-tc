/**
 * In-memory SnapshotStore fake. WP-17's real implementation persists to
 * localStorage, keyed per workbook; this fake keeps the same per-workbook
 * keying contract without touching the DOM, so it works in plain Vitest
 * (no jsdom required) as well as jsdom.
 */
import type { SnapshotStore } from "../contracts.ts";
import type { Snapshot } from "../types.ts";

export function createFakeSnapshotStore(): SnapshotStore {
  const byWorkbook = new Map<string, Snapshot>();
  return {
    async load(workbookId) {
      return byWorkbook.get(workbookId);
    },
    async save(workbookId, snapshot) {
      byWorkbook.set(workbookId, snapshot);
    },
    async clear(workbookId) {
      byWorkbook.delete(workbookId);
    },
  };
}
