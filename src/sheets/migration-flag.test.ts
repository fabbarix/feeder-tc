import { describe, expect, it } from "vitest";
import { createMemoryStorage, createThrowingStorage } from "../sync/test-support/fake-storage.ts";
import { WORKBOOK_SHEET_NAMES } from "./bootstrap.ts";
import { hasWorkbookSchemaMigrated, markWorkbookSchemaMigrated, schemaKeyFor } from "./migration-flag.ts";

describe("schemaKeyFor", () => {
  // The property this WP's review asked for, not a value: pinning the
  // literal hash here would pass forever even if `schemaKeyFor` stopped
  // reacting to the schema at all (e.g. a future edit that accidentally
  // hashes a constant instead of its argument) — exactly the class of bug
  // a hand-maintained version string already was.
  it("changes when the set of sheet names changes (adding a sheet)", () => {
    const before = schemaKeyFor(["Meta", "Settings", "Ingredients"]);
    const after = schemaKeyFor(["Meta", "Settings", "Ingredients", "Photos"]);
    expect(after).not.toBe(before);
  });

  it("changes when the set of sheet names changes (removing a sheet)", () => {
    const before = schemaKeyFor(["Meta", "Settings", "Ingredients", "Photos"]);
    const after = schemaKeyFor(["Meta", "Settings", "Ingredients"]);
    expect(after).not.toBe(before);
  });

  it("changes when a sheet is renamed (same count, different member)", () => {
    const before = schemaKeyFor(["Meta", "Settings", "Ingredients"]);
    const after = schemaKeyFor(["Meta", "Settings", "IngredientsV2"]);
    expect(after).not.toBe(before);
  });

  it("is independent of declaration order — only the SET of names matters", () => {
    const forwards = schemaKeyFor(["Meta", "Settings", "Ingredients"]);
    const backwards = schemaKeyFor(["Ingredients", "Settings", "Meta"]);
    expect(forwards).toBe(backwards);
  });

  it("is stable for the same input", () => {
    expect(schemaKeyFor(WORKBOOK_SHEET_NAMES)).toBe(schemaKeyFor(WORKBOOK_SHEET_NAMES));
  });
});

describe("hasWorkbookSchemaMigrated / markWorkbookSchemaMigrated", () => {
  it("reports not-migrated before anything is marked", () => {
    expect(hasWorkbookSchemaMigrated(createMemoryStorage(), "wb-1")).toBe(false);
  });

  it("reports migrated after marking, for that exact workbook id", () => {
    const storage = createMemoryStorage();
    markWorkbookSchemaMigrated(storage, "wb-1");
    expect(hasWorkbookSchemaMigrated(storage, "wb-1")).toBe(true);
  });

  it("is scoped per workbook id — marking one workbook doesn't mark another", () => {
    const storage = createMemoryStorage();
    markWorkbookSchemaMigrated(storage, "wb-1");
    expect(hasWorkbookSchemaMigrated(storage, "wb-2")).toBe(false);
  });

  it("treats a storage read failure as not-migrated (best-effort, never blocks the real migration)", () => {
    const storage = createThrowingStorage({
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(hasWorkbookSchemaMigrated(storage, "wb-1")).toBe(false);
  });

  it("swallows a storage write failure — marking is best-effort only", () => {
    const storage = createThrowingStorage({
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    });
    expect(() => markWorkbookSchemaMigrated(storage, "wb-1")).not.toThrow();
  });
});
