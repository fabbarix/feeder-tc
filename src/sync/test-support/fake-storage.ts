/**
 * Test-only `Storage` doubles. Not part of the public sync API (not
 * re-exported from `../index.ts`) — used directly by co-located tests to
 * exercise the "localStorage throws" paths that real jsdom localStorage
 * never does on its own.
 */

/** An in-memory Storage impl, so tests get real getItem/setItem/removeItem semantics without touching window.localStorage. */
export function createMemoryStorage(): Storage {
  const backing = new Map<string, string>();
  return {
    get length() {
      return backing.size;
    },
    clear(): void {
      backing.clear();
    },
    getItem(key: string): string | null {
      return backing.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(backing.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      backing.delete(key);
    },
    setItem(key: string, value: string): void {
      backing.set(key, value);
    },
  };
}

/** Wraps a base Storage, overriding selected methods to throw — simulates quota-exceeded / Safari private mode. */
export function createThrowingStorage(overrides: Partial<Storage>, base: Storage = createMemoryStorage()): Storage {
  return { ...base, ...overrides };
}
