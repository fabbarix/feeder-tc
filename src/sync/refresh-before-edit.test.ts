import { describe, expect, it } from "vitest";
import { createFakeWorkbookStore } from "../domain/fakes/index.ts";
import { makeRecipeId, type Recipe } from "../domain/types.ts";
import { refreshBeforeEdit, RefreshBeforeEditNotFoundError } from "./refresh-before-edit.ts";

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: makeRecipeId("r1"),
    name: "Tomato soup",
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    mealTags: ["dinner"],
    status: "in-rotation",
    ...overrides,
  };
}

describe("refreshBeforeEdit", () => {
  it("applies the edit on top of the freshest read, not a stale copy the caller might be holding", async () => {
    const store = createFakeWorkbookStore();
    await store.recipes.upsert(recipe({ name: "Tomato soup" }));

    // Simulate another client having changed the name after our caller last
    // read it, before our edit runs.
    await store.recipes.upsert(recipe({ name: "Tomato soup (updated by someone else)" }));

    const result = await refreshBeforeEdit<Recipe>({
      readAll: () => store.recipes.readAll(),
      upsert: (r) => store.recipes.upsert(r),
      find: (rows) => rows.find((r) => r.id === makeRecipeId("r1")),
      edit: (latest) => ({ ...latest, status: "staple" }),
    });

    // The edit's base was the freshest row (with the other client's name
    // change intact), not whatever the caller had cached.
    expect(result.name).toBe("Tomato soup (updated by someone else)");
    expect(result.status).toBe("staple");

    const persisted = (await store.recipes.readAll()).rows.find((r) => r.id === makeRecipeId("r1"));
    expect(persisted).toEqual(result);
  });

  it("throws RefreshBeforeEditNotFoundError when the row is gone on refresh", async () => {
    const store = createFakeWorkbookStore();

    await expect(
      refreshBeforeEdit({
        readAll: () => store.recipes.readAll(),
        upsert: (r) => store.recipes.upsert(r),
        find: (rows) => rows.find((r) => r.id === makeRecipeId("does-not-exist")),
        edit: (latest) => latest,
      }),
    ).rejects.toBeInstanceOf(RefreshBeforeEditNotFoundError);
  });
});
