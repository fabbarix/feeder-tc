import { describe, expect, it } from "vitest";
import { makeIsoDate, makeRecipeId, type Recipe, type Settings } from "../types.ts";
import {
  DEFAULT_REUSE_GAP_SLOTS,
  buildSlotSequence,
  conservativeSourcePosition,
  effectiveReuseGapSlots,
  expectedSurplusServings,
  projectedLeftoverExpiry,
  reuseGapSatisfied,
} from "./leftover-projection.ts";

function cookedRecipe(baseServings: number, indivisible = false): Recipe {
  return {
    id: makeRecipeId("r"),
    name: "r",
    kind: "cooked",
    baseServings,
    prepMinutes: 10,
    cookMinutes: 20,
    mealTags: ["dinner"],
    status: "in-rotation",
    ...(indivisible ? { indivisible: true } : {}),
  };
}

function boughtRecipe(baseServings: number): Recipe {
  return {
    id: makeRecipeId("b"),
    name: "b",
    kind: "bought",
    baseServings,
    prepMinutes: 0,
    cookMinutes: 10,
    mealTags: ["dinner"],
    status: "in-rotation",
  };
}

describe("expectedSurplusServings", () => {
  it("is 0 for an ordinary cooked recipe scaled exactly to the household size", () => {
    expect(expectedSurplusServings(cookedRecipe(4), 4, 4)).toBe(0);
  });

  it("is the excess when a cooked recipe is deliberately scaled above the household size (the owner's own example: a 4-serving chili for a 2-person household)", () => {
    expect(expectedSurplusServings(cookedRecipe(4), 4, 2)).toBe(2);
  });

  it("uses scaleIndivisible's whole-unit rounding for a bought meal (serves 6, household of 4 -> 2 left over)", () => {
    expect(expectedSurplusServings(boughtRecipe(6), 4, 4)).toBe(2);
  });

  it("uses scaleIndivisible for indivisible: true even when kind is cooked", () => {
    expect(expectedSurplusServings(cookedRecipe(4, true), 3, 3)).toBe(1);
  });

  it("is 0 when targetServings is non-positive", () => {
    expect(expectedSurplusServings(cookedRecipe(4), 0, 4)).toBe(0);
  });
});

describe("projectedLeftoverExpiry", () => {
  it("adds shelfLifeDays to the cook date, same arithmetic createLeftoverLot uses", () => {
    expect(projectedLeftoverExpiry(makeIsoDate("2026-08-17"), 4)).toBe("2026-08-21");
  });
});

describe("effectiveReuseGapSlots", () => {
  it("defaults to DEFAULT_REUSE_GAP_SLOTS when absent", () => {
    const settings: Settings = { householdSize: 2, slotLayout: [], repeatExclusionWeeks: 3 };
    expect(effectiveReuseGapSlots(settings)).toBe(DEFAULT_REUSE_GAP_SLOTS);
  });

  it("uses the explicit value, floored at 0", () => {
    const settings: Settings = { householdSize: 2, slotLayout: [], repeatExclusionWeeks: 3, reuseGapSlots: 5 };
    expect(effectiveReuseGapSlots(settings)).toBe(5);
    const negative: Settings = { householdSize: 2, slotLayout: [], repeatExclusionWeeks: 3, reuseGapSlots: -3 };
    expect(effectiveReuseGapSlots(negative)).toBe(0);
  });
});

const threeMealSettings: Settings = {
  householdSize: 2,
  repeatExclusionWeeks: 0,
  slotLayout: [
    { day: "monday", slots: ["breakfast", "lunch", "dinner"] },
    { day: "tuesday", slots: ["breakfast", "lunch", "dinner"] },
    { day: "wednesday", slots: ["breakfast", "lunch", "dinner"] },
  ],
};

describe("buildSlotSequence / reuseGapSatisfied — gap arithmetic", () => {
  it("counts every configured slot in between, regardless of meal type (a breakfast counts)", () => {
    const seq = buildSlotSequence(threeMealSettings, makeIsoDate("2026-08-17"), makeIsoDate("2026-08-19"));
    // Monday breakfast(0) lunch(1) dinner(2), Tuesday breakfast(3) lunch(4) dinner(5), Wednesday breakfast(6)...
    // Monday dinner (index 2) -> Tuesday dinner (index 5): 2 slots between (Wed breakfast/lunch not involved).
    const source = { date: makeIsoDate("2026-08-17"), slotIndex: 2 }; // Monday dinner
    const target = { date: makeIsoDate("2026-08-18"), slotIndex: 2 }; // Tuesday dinner
    expect(reuseGapSatisfied(seq, source, target, 2)).toBe(true);
  });

  it("is honoured exactly at its boundary: gap of 2 fails with only 1 slot between, succeeds with exactly 2", () => {
    const seq = buildSlotSequence(threeMealSettings, makeIsoDate("2026-08-17"), makeIsoDate("2026-08-19"));
    // Monday dinner (idx 2) -> Tuesday lunch (idx 4): exactly 1 slot between (Tuesday breakfast).
    const oneBetween = { date: makeIsoDate("2026-08-18"), slotIndex: 1 }; // Tuesday lunch
    const source = { date: makeIsoDate("2026-08-17"), slotIndex: 2 };
    expect(reuseGapSatisfied(seq, source, oneBetween, 2)).toBe(false);

    // Monday dinner (idx 2) -> Tuesday dinner (idx 5): exactly 2 slots between (Tuesday breakfast, lunch).
    const twoBetween = { date: makeIsoDate("2026-08-18"), slotIndex: 2 };
    expect(reuseGapSatisfied(seq, source, twoBetween, 2)).toBe(true);
  });

  it("rejects a target on or before the source", () => {
    const seq = buildSlotSequence(threeMealSettings, makeIsoDate("2026-08-17"), makeIsoDate("2026-08-19"));
    const same = { date: makeIsoDate("2026-08-17"), slotIndex: 2 };
    expect(reuseGapSatisfied(seq, same, same, 0)).toBe(false);
    const earlier = { date: makeIsoDate("2026-08-17"), slotIndex: 0 };
    expect(reuseGapSatisfied(seq, same, earlier, 0)).toBe(false);
  });

  it("returns false for a position outside the sequence's range", () => {
    const seq = buildSlotSequence(threeMealSettings, makeIsoDate("2026-08-17"), makeIsoDate("2026-08-18"));
    const inRange = { date: makeIsoDate("2026-08-17"), slotIndex: 0 };
    const outOfRange = { date: makeIsoDate("2026-09-01"), slotIndex: 0 };
    expect(reuseGapSatisfied(seq, inRange, outOfRange, 0)).toBe(false);
  });

  it("gap of 0 only requires the target to come after the source", () => {
    const seq = buildSlotSequence(threeMealSettings, makeIsoDate("2026-08-17"), makeIsoDate("2026-08-17"));
    const source = { date: makeIsoDate("2026-08-17"), slotIndex: 0 };
    const nextSlot = { date: makeIsoDate("2026-08-17"), slotIndex: 1 };
    expect(reuseGapSatisfied(seq, source, nextSlot, 0)).toBe(true);
  });
});

describe("conservativeSourcePosition — approximate gap anchor for a REAL leftover lot", () => {
  it("anchors on the LAST configured slot of the purchase day, not the first", () => {
    const position = conservativeSourcePosition(threeMealSettings, makeIsoDate("2026-08-17")); // Monday: breakfast, lunch, dinner
    expect(position).toEqual({ date: makeIsoDate("2026-08-17"), slotIndex: 2 }); // dinner, index 2 — the conservative (never-under-count) choice
  });

  it("returns undefined when the current layout has no configured slots at all for that weekday", () => {
    const noSaturdaySettings: Settings = {
      householdSize: 2,
      repeatExclusionWeeks: 0,
      slotLayout: [{ day: "monday", slots: ["dinner"] }], // no saturday entry
    };
    expect(conservativeSourcePosition(noSaturdaySettings, makeIsoDate("2026-08-22"))).toBeUndefined(); // a Saturday
  });
});
