/**
 * Shared localStorage helpers for the sync layer (SnapshotStore + Outbox).
 *
 * localStorage can throw synchronously: quota exceeded on write, Safari
 * private-mode denying writes outright, or a value under our key that
 * fails to parse (corrupted, or written by a different app version). This
 * module makes every one of those failures explicit — wrapped in
 * `SyncStorageError` — rather than swallowing it. What each *caller* does
 * with that explicit failure differs by what's at stake (see the policy
 * comments in snapshot-store.ts and outbox.ts): a lost cache entry is safe
 * to shrug off, a lost pending write is not.
 */

export class SyncStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SyncStorageError";
  }
}

export function readRaw(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch (cause) {
    throw new SyncStorageError(`localStorage.getItem failed for key ${JSON.stringify(key)}`, { cause });
  }
}

export function writeRaw(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch (cause) {
    throw new SyncStorageError(
      `localStorage.setItem failed for key ${JSON.stringify(key)} (quota exceeded or storage unavailable)`,
      { cause },
    );
  }
}

export function removeRaw(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch (cause) {
    throw new SyncStorageError(`localStorage.removeItem failed for key ${JSON.stringify(key)}`, { cause });
  }
}

export function parseJson<T>(raw: string, key: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new SyncStorageError(`Corrupt JSON under localStorage key ${JSON.stringify(key)}`, { cause });
  }
}
