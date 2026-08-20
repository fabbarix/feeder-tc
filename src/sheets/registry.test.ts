import { beforeEach, describe, expect, it } from "vitest";
import { createWorkbookRegistry } from "./registry.ts";

const KEY = "feeder.workbookRegistry.test";

beforeEach(() => {
  localStorage.clear();
});

describe("createWorkbookRegistry", () => {
  it("starts empty with no active workbook", () => {
    const registry = createWorkbookRegistry(localStorage, KEY);
    expect(registry.list()).toEqual([]);
    expect(registry.getActive()).toBeUndefined();
  });

  it("adding the first workbook makes it active automatically", () => {
    const registry = createWorkbookRegistry(localStorage, KEY);
    registry.add({ id: "fam-123", name: "Family Meal Planner" });
    expect(registry.list()).toEqual([{ id: "fam-123", name: "Family Meal Planner" }]);
    expect(registry.getActive()).toEqual({ id: "fam-123", name: "Family Meal Planner" });
  });

  it("adding a second workbook does not change which one is active", () => {
    const registry = createWorkbookRegistry(localStorage, KEY);
    registry.add({ id: "fam-123", name: "Family Meal Planner" });
    registry.add({ id: "other-456", name: "In-laws Planner" });
    expect(registry.list()).toHaveLength(2);
    expect(registry.getActive()?.id).toBe("fam-123");
  });

  it("setActive switches the active workbook", () => {
    const registry = createWorkbookRegistry(localStorage, KEY);
    registry.add({ id: "fam-123", name: "Family Meal Planner" });
    registry.add({ id: "other-456", name: "In-laws Planner" });
    registry.setActive("other-456");
    expect(registry.getActive()?.id).toBe("other-456");
  });

  it("setActive throws for an unregistered id", () => {
    const registry = createWorkbookRegistry(localStorage, KEY);
    expect(() => registry.setActive("nope")).toThrow();
  });

  it("add() upserts by id, last-write-wins on the name", () => {
    const registry = createWorkbookRegistry(localStorage, KEY);
    registry.add({ id: "fam-123", name: "Old Name" });
    registry.add({ id: "fam-123", name: "New Name" });
    expect(registry.list()).toEqual([{ id: "fam-123", name: "New Name" }]);
  });

  it("remove() drops the entry and clears active if it was the active one", () => {
    const registry = createWorkbookRegistry(localStorage, KEY);
    registry.add({ id: "fam-123", name: "Family Meal Planner" });
    registry.remove("fam-123");
    expect(registry.list()).toEqual([]);
    expect(registry.getActive()).toBeUndefined();
  });

  it("persists across instances backed by the same storage/key", () => {
    const first = createWorkbookRegistry(localStorage, KEY);
    first.add({ id: "fam-123", name: "Family Meal Planner" });

    const second = createWorkbookRegistry(localStorage, KEY);
    expect(second.getActive()).toEqual({ id: "fam-123", name: "Family Meal Planner" });
  });

  it("never throws on malformed stored JSON - starts empty instead", () => {
    localStorage.setItem(KEY, "{not json");
    const registry = createWorkbookRegistry(localStorage, KEY);
    expect(registry.list()).toEqual([]);
  });

  it("ignores an activeId that does not correspond to any stored entry", () => {
    localStorage.setItem(KEY, JSON.stringify({ entries: [], activeId: "ghost" }));
    const registry = createWorkbookRegistry(localStorage, KEY);
    expect(registry.getActive()).toBeUndefined();
  });
});
