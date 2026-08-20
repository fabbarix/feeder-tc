import { describe, expect, it } from "vitest";
import {
  makeIsoDate,
  makeLotId,
  makePlanSlotId,
  makeRecipeId,
  type PlanSlot,
  type Recipe,
} from "../types.ts";
import { candidatesForSlot, recentlyCookedRecipeIds } from "./candidates.ts";

function recipe(id: string, mealTags: Recipe["mealTags"], status: Recipe["status"]): Recipe {
  return {
    id: makeRecipeId(id),
    name: id,
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    mealTags,
    status,
  };
}

describe("candidatesForSlot", () => {
  const recipes: Recipe[] = [
    recipe("dinner-staple", ["dinner"], "staple"),
    recipe("dinner-rotation", ["dinner"], "in-rotation"),
    recipe("dinner-retired", ["dinner"], "retired"),
    recipe("lunch-rotation", ["lunch"], "in-rotation"),
    recipe("multi-tag", ["dinner", "lunch"], "in-rotation"),
  ];

  it("filters by meal tag and status", () => {
    const pool = candidatesForSlot(recipes, "dinner", ["in-rotation"]);
    expect(pool.map((r) => r.id).sort()).toEqual(["dinner-rotation", "multi-tag"].sort());
  });

  it("never returns a retired recipe even when asked for every status except retired", () => {
    const pool = candidatesForSlot(recipes, "dinner", ["staple", "in-rotation"]);
    expect(pool.some((r) => r.status === "retired")).toBe(false);
  });

  it("never returns a recipe untagged for the requested meal", () => {
    const pool = candidatesForSlot(recipes, "dinner", ["staple", "in-rotation", "retired"]);
    expect(pool.every((r) => r.mealTags.includes("dinner"))).toBe(true);
    expect(pool.some((r) => r.id === "lunch-rotation")).toBe(false);
  });
});

function cookedSlot(date: string, recipeId: string): PlanSlot {
  return {
    id: makePlanSlotId(`slot-${date}-${recipeId}`),
    date: makeIsoDate(date),
    slotType: "dinner",
    slotIndex: 0,
    filling: { kind: "recipe", recipeId: makeRecipeId(recipeId) },
    state: "cooked",
    pinned: false,
  };
}

describe("recentlyCookedRecipeIds", () => {
  it("excludes a recipe cooked within the exclusion window", () => {
    // Carbonara cooked 1 week before a week starting 2026-08-17, window 3 weeks.
    const past = [cookedSlot("2026-08-10", "carbonara")];
    const ids = recentlyCookedRecipeIds(past, makeIsoDate("2026-08-17"), 3);
    expect(ids.has(makeRecipeId("carbonara"))).toBe(true);
  });

  it("does not exclude a recipe cooked before the exclusion window", () => {
    const past = [cookedSlot("2026-07-01", "carbonara")];
    const ids = recentlyCookedRecipeIds(past, makeIsoDate("2026-08-17"), 3);
    expect(ids.has(makeRecipeId("carbonara"))).toBe(false);
  });

  it("ignores non-cooked slots and non-recipe fillings", () => {
    const plannedNotCooked: PlanSlot = { ...cookedSlot("2026-08-16", "chili"), state: "planned" };
    const leftover: PlanSlot = {
      ...cookedSlot("2026-08-16", "chili"),
      filling: { kind: "leftover", lotId: makeLotId("lot-1") },
    };
    const ids = recentlyCookedRecipeIds([plannedNotCooked, leftover], makeIsoDate("2026-08-17"), 3);
    expect(ids.size).toBe(0);
  });

  it("disables the exclusion entirely when the window is 0 or negative", () => {
    const past = [cookedSlot("2026-08-16", "carbonara")];
    expect(recentlyCookedRecipeIds(past, makeIsoDate("2026-08-17"), 0).size).toBe(0);
    expect(recentlyCookedRecipeIds(past, makeIsoDate("2026-08-17"), -1).size).toBe(0);
  });
});
