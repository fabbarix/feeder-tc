import { describe, expect, it } from "vitest";
import { parseJson, readRaw, removeRaw, writeRaw, SyncStorageError } from "./storage.ts";
import { createMemoryStorage, createThrowingStorage } from "./test-support/fake-storage.ts";

describe("storage helpers", () => {
  it("readRaw returns the stored value", () => {
    const storage = createMemoryStorage();
    storage.setItem("k", "v");
    expect(readRaw(storage, "k")).toBe("v");
  });

  it("readRaw returns null for a missing key", () => {
    expect(readRaw(createMemoryStorage(), "missing")).toBeNull();
  });

  it("readRaw wraps a thrown getItem error as SyncStorageError", () => {
    const storage = createThrowingStorage({
      getItem: () => {
        throw new Error("boom");
      },
    });
    expect(() => readRaw(storage, "k")).toThrow(SyncStorageError);
  });

  it("writeRaw wraps a thrown setItem error as SyncStorageError", () => {
    const storage = createThrowingStorage({
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    });
    expect(() => writeRaw(storage, "k", "v")).toThrow(SyncStorageError);
  });

  it("removeRaw wraps a thrown removeItem error as SyncStorageError", () => {
    const storage = createThrowingStorage({
      removeItem: () => {
        throw new Error("boom");
      },
    });
    expect(() => removeRaw(storage, "k")).toThrow(SyncStorageError);
  });

  it("parseJson wraps a JSON.parse failure as SyncStorageError", () => {
    expect(() => parseJson("{ not json", "k")).toThrow(SyncStorageError);
  });

  it("parseJson returns the parsed value on valid JSON", () => {
    expect(parseJson<{ a: number }>('{"a":1}', "k")).toEqual({ a: 1 });
  });
});
