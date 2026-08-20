import { describe, expect, it } from "vitest";
import { createFakeRng } from "./fakes/rng.ts";
import { newEventId, newIngredientId, newLotId, newPlanSlotId, newRecipeId, randomIdString } from "./ids.ts";

describe("randomIdString", () => {
  it("is deterministic under a seeded Rng", () => {
    expect(randomIdString(createFakeRng(1))).toBe(randomIdString(createFakeRng(1)));
  });

  it("differs across seeds", () => {
    expect(randomIdString(createFakeRng(1))).not.toBe(randomIdString(createFakeRng(2)));
  });

  it("respects the requested length", () => {
    expect(randomIdString(createFakeRng(1), 10)).toHaveLength(10);
  });
});

describe("new*Id generators", () => {
  it("each produces a non-empty branded id (design requirement 3: client-generated ids)", () => {
    const rng = createFakeRng(1);
    expect(newEventId(rng).length).toBeGreaterThan(0);
    expect(newLotId(rng).length).toBeGreaterThan(0);
    expect(newPlanSlotId(rng).length).toBeGreaterThan(0);
    expect(newIngredientId(rng).length).toBeGreaterThan(0);
    expect(newRecipeId(rng).length).toBeGreaterThan(0);
  });

  it("successive calls against the same Rng produce different ids", () => {
    const rng = createFakeRng(1);
    const a = newEventId(rng);
    const b = newEventId(rng);
    expect(a).not.toBe(b);
  });
});
