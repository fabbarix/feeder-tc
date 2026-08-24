/**
 * Pure logic tests for the offline photo-import queue — DESIGN_RECIPE_IMPORT_PHOTO.md
 * §12. No canvas, no fetch: a fabricated `Storage` (same fake used by
 * `settings.test.ts`-style tests elsewhere in this package) is enough to
 * prove enqueue/read/clear.
 */
import { describe, expect, it } from "vitest";
import { clearPendingPhotoImport, enqueuePendingPhotoImport, readPendingPhotoImport } from "./photo-queue.ts";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  };
}

const SETTINGS = { baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "gpt-4o" };

describe("photo import queue", () => {
  it("reads undefined when nothing is queued", () => {
    expect(readPendingPhotoImport(fakeStorage())).toBeUndefined();
  });

  it("enqueues and reads back an item", () => {
    const storage = fakeStorage();
    const item = enqueuePendingPhotoImport(
      { id: "photo-import-1", photos: ["data:image/jpeg;base64,AAA"], settings: SETTINGS },
      storage,
    );
    expect(item.id).toBe("photo-import-1");
    expect(item.queuedAt).toEqual(expect.any(String));

    const read = readPendingPhotoImport(storage);
    expect(read).toEqual(item);
  });

  it("a duplicate submit with the same id does not double-queue — the existing item is returned unchanged", () => {
    const storage = fakeStorage();
    const first = enqueuePendingPhotoImport(
      { id: "photo-import-1", photos: ["data:image/jpeg;base64,AAA"], settings: SETTINGS },
      storage,
    );
    const second = enqueuePendingPhotoImport(
      { id: "photo-import-1", photos: ["data:image/jpeg;base64,BBB"], settings: SETTINGS },
      storage,
    );
    expect(second).toEqual(first);
    expect(readPendingPhotoImport(storage)!.photos).toEqual(["data:image/jpeg;base64,AAA"]);
  });

  it("a new id replaces whatever was queued before — only one pending item at a time", () => {
    const storage = fakeStorage();
    enqueuePendingPhotoImport({ id: "photo-import-1", photos: ["data:image/jpeg;base64,AAA"], settings: SETTINGS }, storage);
    const second = enqueuePendingPhotoImport(
      { id: "photo-import-2", photos: ["data:image/jpeg;base64,BBB"], settings: SETTINGS },
      storage,
    );
    expect(readPendingPhotoImport(storage)).toEqual(second);
  });

  it("clears the pending item", () => {
    const storage = fakeStorage();
    enqueuePendingPhotoImport({ id: "photo-import-1", photos: ["data:image/jpeg;base64,AAA"], settings: SETTINGS }, storage);
    clearPendingPhotoImport(storage);
    expect(readPendingPhotoImport(storage)).toBeUndefined();
  });

  it("degrades to undefined, not a throw, for a corrupted stored value", () => {
    const storage = fakeStorage();
    storage.setItem("feeder.recipeImport.photoQueue.v1", "{not valid json");
    expect(readPendingPhotoImport(storage)).toBeUndefined();
  });

  it("degrades to undefined for a value missing required fields", () => {
    const storage = fakeStorage();
    storage.setItem("feeder.recipeImport.photoQueue.v1", JSON.stringify({ id: "x" }));
    expect(readPendingPhotoImport(storage)).toBeUndefined();
  });

  it("degrades to undefined for an empty photos array", () => {
    const storage = fakeStorage();
    storage.setItem(
      "feeder.recipeImport.photoQueue.v1",
      JSON.stringify({ id: "x", photos: [], settings: SETTINGS, queuedAt: new Date().toISOString() }),
    );
    expect(readPendingPhotoImport(storage)).toBeUndefined();
  });
});
