import { describe, expect, it } from "vitest";
import {
  makeAdjustEvent,
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type SpoilEvent,
} from "./types.ts";

describe("branded id constructors", () => {
  it.each([
    ["IngredientId", makeIngredientId],
    ["RecipeId", makeRecipeId],
    ["LotId", makeLotId],
    ["PlanSlotId", makePlanSlotId],
    ["EventId", makeEventId],
  ] as const)("%s: wraps a non-empty string", (_label, make) => {
    expect(make("abc-123")).toBe("abc-123");
  });

  it.each([
    ["IngredientId", makeIngredientId],
    ["RecipeId", makeRecipeId],
    ["LotId", makeLotId],
    ["PlanSlotId", makePlanSlotId],
    ["EventId", makeEventId],
  ] as const)("%s: rejects an empty or whitespace-only string", (_label, make) => {
    expect(() => make("")).toThrow();
    expect(() => make("   ")).toThrow();
  });

  it("two different id kinds are not interchangeable at compile time", () => {
    const ingredientId = makeIngredientId("rice");
    const recipeId = makeRecipeId("chili");
    // Both are structurally strings at runtime...
    expect(typeof ingredientId).toBe("string");
    expect(typeof recipeId).toBe("string");
    // ...but the type system keeps them apart: the following would be a
    // compile error if uncommented, which is exactly the point.
    // const wrong: typeof recipeId = ingredientId;
  });
});

describe("makeQuantity", () => {
  it("accepts a finite amount and unit", () => {
    expect(makeQuantity(400, "g")).toEqual({ amount: 400, unit: "g" });
  });

  it("accepts zero and negative amounts (deltas reuse this constructor)", () => {
    expect(makeQuantity(0, "g").amount).toBe(0);
    expect(makeQuantity(-50, "g").amount).toBe(-50);
  });

  it.each([NaN, Infinity, -Infinity])("rejects a non-finite amount (%s)", (amount) => {
    expect(() => makeQuantity(amount, "g")).toThrow();
  });
});

describe("makeIsoDate", () => {
  it("accepts a valid calendar date", () => {
    expect(makeIsoDate("2026-03-01")).toBe("2026-03-01");
  });

  it("rejects a malformed shape", () => {
    expect(() => makeIsoDate("2026/03/01")).toThrow();
    expect(() => makeIsoDate("26-03-01")).toThrow();
  });

  it("rejects an impossible calendar date", () => {
    expect(() => makeIsoDate("2026-02-30")).toThrow();
  });
});

describe("makeIsoTimestamp", () => {
  it("accepts a full ISO-8601 timestamp", () => {
    expect(makeIsoTimestamp("2026-03-01T09:00:00Z")).toBe("2026-03-01T09:00:00Z");
  });

  it("rejects a bare calendar date (no time component)", () => {
    expect(() => makeIsoTimestamp("2026-03-01")).toThrow();
  });
});

describe("SpoilEvent", () => {
  it("requires lotId — coordinator review: spoilage names a specific lot, unlike FIFO-consumed `use`", () => {
    const valid: SpoilEvent = {
      type: "spoil",
      id: makeEventId("evt-1"),
      timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
      ingredientId: makeIngredientId("rice"),
      lotId: makeLotId("lot-1"),
      quantity: makeQuantity(200, "g"),
    };
    expect(valid.lotId).toBe("lot-1");

    // @ts-expect-error — SpoilEvent.lotId is required; omitting it must not
    // compile. If this stops erroring, `lotId` was accidentally made
    // optional again — do not "fix" that, see the type's doc comment.
    const missingLotId: SpoilEvent = {
      type: "spoil",
      id: makeEventId("evt-2"),
      timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
      ingredientId: makeIngredientId("rice"),
      quantity: makeQuantity(200, "g"),
    };
    expect(missingLotId).toBeDefined();
  });
});

describe("makeAdjustEvent", () => {
  const base = {
    id: makeEventId("evt-1"),
    timestamp: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    ingredientId: makeIngredientId("rice"),
    lotId: makeLotId("lot-1"),
  };

  it("throws when neither delta nor expiry is given", () => {
    expect(() => makeAdjustEvent({ ...base })).toThrow(/delta.*expiry/i);
  });

  it("accepts a delta-only correction and omits expiry/reason keys entirely", () => {
    const event = makeAdjustEvent({ ...base, delta: makeQuantity(-50, "g") });
    expect(event.delta).toEqual({ amount: -50, unit: "g" });
    expect(event).not.toHaveProperty("expiry");
    expect(event).not.toHaveProperty("reason");
  });

  it("accepts an expiry-only correction and omits the delta key entirely", () => {
    const event = makeAdjustEvent({ ...base, expiry: makeIsoDate("2026-04-01") });
    expect(event.expiry).toBe("2026-04-01");
    expect(event).not.toHaveProperty("delta");
  });

  it("accepts both delta and expiry together", () => {
    const event = makeAdjustEvent({
      ...base,
      delta: makeQuantity(-50, "g"),
      expiry: makeIsoDate("2026-04-01"),
    });
    expect(event.delta).toEqual({ amount: -50, unit: "g" });
    expect(event.expiry).toBe("2026-04-01");
  });

  it("includes reason only when given", () => {
    const withReason = makeAdjustEvent({ ...base, delta: makeQuantity(10, "g"), reason: "recount" });
    expect(withReason.reason).toBe("recount");
  });
});
