import { describe, expect, it } from "vitest";
import { createFakeRng } from "../fakes/rng.ts";
import {
  makeIngredientId,
  makeIsoDate,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type MealTag,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type RecipeStatus,
  type Settings,
} from "../types.ts";
import { generateWeek, rerollSlot, setSlotPinned } from "./generator.ts";

function recipe(
  id: string,
  mealTags: readonly MealTag[],
  status: RecipeStatus,
  baseServings = 4,
): Recipe {
  return {
    id: makeRecipeId(id),
    name: id,
    kind: "cooked",
    baseServings,
    prepMinutes: 10,
    cookMinutes: 20,
    mealTags,
    status,
  };
}

const dinnerOnlySettings: Settings = {
  householdSize: 4,
  repeatExclusionWeeks: 3,
  slotLayout: [
    { day: "monday", slots: ["dinner"] },
    { day: "tuesday", slots: ["dinner"] },
    { day: "wednesday", slots: ["dinner"] },
    { day: "thursday", slots: ["dinner"] },
    { day: "friday", slots: ["dinner"] },
    { day: "saturday", slots: ["dinner"] },
    { day: "sunday", slots: ["dinner"] },
  ],
};

const WEEK_START = makeIsoDate("2026-08-17"); // a Monday

function recipeFillingIds(slots: readonly PlanSlot[]): (string | undefined)[] {
  return slots.map((s) => (s.filling.kind === "recipe" ? s.filling.recipeId : undefined));
}

describe("generateWeek — staples before random fill", () => {
  it("both staples appear exactly once when 2 staples and 10 in-rotation recipes fill 7 dinner slots", () => {
    const staples = [recipe("staple-1", ["dinner"], "staple"), recipe("staple-2", ["dinner"], "staple")];
    const rotation = Array.from({ length: 10 }, (_, i) => recipe(`rot-${i}`, ["dinner"], "in-rotation"));
    const recipes = [...staples, ...rotation];

    const result = generateWeek({
      settings: dinnerOnlySettings,
      weekStart: WEEK_START,
      recipes,
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      rng: createFakeRng(1),
    });

    expect(result.slots).toHaveLength(7);
    const placedIds = recipeFillingIds(result.slots);
    expect(placedIds.filter((id) => id === "staple-1")).toHaveLength(1);
    expect(placedIds.filter((id) => id === "staple-2")).toHaveLength(1);
    // Remaining 5 slots are filled from the in-rotation pool, not empty.
    expect(placedIds.every((id) => id !== undefined)).toBe(true);
  });
});

describe("generateWeek — cross-week staple round-robin", () => {
  it("9 staples / 7 dinner slots: every staple appears at least once across two weeks, none twice before all have appeared", () => {
    const staples = Array.from({ length: 9 }, (_, i) => recipe(`staple-${i}`, ["dinner"], "staple"));

    const week1 = generateWeek({
      settings: dinnerOnlySettings,
      weekStart: WEEK_START,
      recipes: staples,
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      rng: createFakeRng(2),
    });
    const week2 = generateWeek({
      settings: dinnerOnlySettings,
      weekStart: makeIsoDate("2026-08-24"),
      recipes: staples,
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      staplePlanState: week1.staplePlanState,
      rng: createFakeRng(3),
    });

    const week1Ids = new Set(recipeFillingIds(week1.slots).filter((id): id is string => id !== undefined));
    const week2Ids = new Set(recipeFillingIds(week2.slots).filter((id): id is string => id !== undefined));
    expect(week1Ids.size).toBe(7);
    expect(week2Ids.size).toBe(2);

    for (const s of staples) {
      expect(week1Ids.has(s.id) || week2Ids.has(s.id)).toBe(true);
    }
    // No staple placed in week1 is repeated in week2 (all 9 are distinct across both weeks).
    for (const id of week2Ids) {
      expect(week1Ids.has(id)).toBe(false);
    }
  });
});

describe("generateWeek — recently cooked exclusion", () => {
  it("a recipe cooked within the exclusion window is never selected", () => {
    const carbonara = recipe("carbonara", ["dinner"], "in-rotation");
    const other = recipe("other", ["dinner"], "in-rotation");
    const pastSlot: PlanSlot = {
      id: makePlanSlotId("past-1"),
      date: makeIsoDate("2026-08-10"), // 1 week before WEEK_START
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "recipe", recipeId: carbonara.id },
      state: "cooked",
      pinned: false,
    };

    for (let seed = 0; seed < 20; seed += 1) {
      const result = generateWeek({
        settings: dinnerOnlySettings,
        weekStart: WEEK_START,
        recipes: [carbonara, other],
        recipeIngredients: [],
        pastPlanSlots: [pastSlot],
        expiringIngredientIds: new Set(),
        rng: createFakeRng(seed),
      });
      expect(recipeFillingIds(result.slots).includes("carbonara")).toBe(false);
    }
  });
});

describe("generateWeek — expiring pantry lots boost matching recipes", () => {
  it("Roast chicken (uses chicken, expiring) is selected significantly more often than a baseline recipe", () => {
    const chicken = makeIngredientId("chicken");
    const roastChicken = recipe("roast-chicken", ["dinner"], "in-rotation");
    const baseline = recipe("baseline", ["dinner"], "in-rotation");
    const recipeIngredients: RecipeIngredient[] = [
      { recipeId: roastChicken.id, ingredientId: chicken, quantity: makeQuantity(1, "piece") },
    ];

    const singleDinnerSlotSettings: Settings = {
      householdSize: 4,
      repeatExclusionWeeks: 0,
      slotLayout: [{ day: "monday", slots: ["dinner"] }],
    };

    const SEEDS = 1000;
    let roastCount = 0;
    let baselineCount = 0;
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const result = generateWeek({
        settings: singleDinnerSlotSettings,
        weekStart: WEEK_START,
        recipes: [roastChicken, baseline],
        recipeIngredients,
        pastPlanSlots: [],
        expiringIngredientIds: new Set([chicken]),
        rng: createFakeRng(seed),
      });
      const picked = recipeFillingIds(result.slots)[0];
      if (picked === "roast-chicken") roastCount += 1;
      if (picked === "baseline") baselineCount += 1;
    }

    expect(roastCount + baselineCount).toBe(SEEDS);
    // Weight model: baseline=1, roast-chicken=1+EXPIRING_BOOST(5)=6 -> expected ~6:1.
    expect(roastCount).toBeGreaterThan(baselineCount * 3);
  });
});

describe("generateWeek — retired recipes never appear", () => {
  it("a retired recipe is never selected", () => {
    const liverStew = recipe("liver-stew", ["dinner"], "retired");
    const other = recipe("other", ["dinner"], "in-rotation");
    for (let seed = 0; seed < 20; seed += 1) {
      const result = generateWeek({
        settings: dinnerOnlySettings,
        weekStart: WEEK_START,
        recipes: [liverStew, other],
        recipeIngredients: [],
        pastPlanSlots: [],
        expiringIngredientIds: new Set(),
        rng: createFakeRng(seed),
      });
      expect(recipeFillingIds(result.slots).includes("liver-stew")).toBe(false);
    }
  });
});

describe("generateWeek — determinism", () => {
  it("same seed and inputs always produce the same week", () => {
    const staples = [recipe("staple-1", ["dinner"], "staple")];
    const rotation = Array.from({ length: 5 }, (_, i) => recipe(`rot-${i}`, ["dinner"], "in-rotation"));
    const recipes = [...staples, ...rotation];
    const input = {
      settings: dinnerOnlySettings,
      weekStart: WEEK_START,
      recipes,
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set<never>(),
    };
    const a = generateWeek({ ...input, rng: createFakeRng(99) });
    const b = generateWeek({ ...input, rng: createFakeRng(99) });
    expect(a.slots).toEqual(b.slots);
  });
});

describe("generateWeek — never places a retired or wrong-meal-tag recipe (property test over random catalogs)", () => {
  it("holds across many randomly generated catalogs and settings", () => {
    const rng = createFakeRng(1234);
    const mealTags: readonly MealTag[] = ["breakfast", "lunch", "dinner", "snack"];
    const statuses: readonly RecipeStatus[] = ["staple", "in-rotation", "retired"];

    for (let trial = 0; trial < 200; trial += 1) {
      const recipeCount = 1 + Math.floor(rng.next() * 15);
      const recipes: Recipe[] = [];
      for (let i = 0; i < recipeCount; i += 1) {
        const tagCount = 1 + Math.floor(rng.next() * mealTags.length);
        const tags = new Set<MealTag>();
        while (tags.size < tagCount) {
          const idx = Math.floor(rng.next() * mealTags.length);
          const tag = mealTags[idx];
          if (tag !== undefined) tags.add(tag);
        }
        const statusIdx = Math.floor(rng.next() * statuses.length);
        const status = statuses[statusIdx] ?? "in-rotation";
        recipes.push(recipe(`r${trial}-${i}`, [...tags], status));
      }

      const settings: Settings = {
        householdSize: 1 + Math.floor(rng.next() * 6),
        repeatExclusionWeeks: Math.floor(rng.next() * 4),
        slotLayout: [
          { day: "monday", slots: ["breakfast", "dinner"] },
          { day: "tuesday", slots: ["lunch", "dinner"] },
          { day: "wednesday", slots: ["dinner", "snack"] },
          { day: "thursday", slots: ["dinner"] },
          { day: "friday", slots: ["breakfast", "lunch", "dinner"] },
          { day: "saturday", slots: ["dinner", "snack"] },
          { day: "sunday", slots: ["dinner"] },
        ],
      };

      const result = generateWeek({
        settings,
        weekStart: WEEK_START,
        recipes,
        recipeIngredients: [],
        pastPlanSlots: [],
        expiringIngredientIds: new Set(),
        rng,
      });

      const byId = new Map(recipes.map((r) => [r.id, r] as const));
      for (const slot of result.slots) {
        if (slot.filling.kind !== "recipe") continue;
        const placedRecipe = byId.get(slot.filling.recipeId);
        expect(placedRecipe).toBeDefined();
        expect(placedRecipe?.status).not.toBe("retired");
        expect(placedRecipe?.mealTags.includes(slot.slotType)).toBe(true);
      }
    }
  });
});

describe("generateWeek — pinned and non-planned slots are left untouched", () => {
  const staples: Recipe[] = [];
  const rotation = Array.from({ length: 5 }, (_, i) => recipe(`rot-${i}`, ["dinner"], "in-rotation"));

  it("a pinned slot's filling and id survive regeneration", () => {
    const pinnedFilling = { kind: "recipe" as const, recipeId: makeRecipeId("rot-0") };
    const pinnedSlot: PlanSlot = {
      id: makePlanSlotId("existing-monday-dinner"),
      date: makeIsoDate("2026-08-17"),
      slotType: "dinner",
      slotIndex: 0,
      filling: pinnedFilling,
      state: "planned",
      pinned: true,
    };

    const result = generateWeek({
      settings: dinnerOnlySettings,
      weekStart: WEEK_START,
      recipes: [...staples, ...rotation],
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      existingSlots: [pinnedSlot],
      rng: createFakeRng(5),
    });

    const monday = result.slots.find((s) => s.date === makeIsoDate("2026-08-17"));
    expect(monday).toEqual(pinnedSlot);
  });

  it("an already-cooked slot is preserved even though it is not pinned", () => {
    const cookedFilling = { kind: "recipe" as const, recipeId: makeRecipeId("rot-1") };
    const cookedSlot: PlanSlot = {
      id: makePlanSlotId("existing-tuesday-dinner"),
      date: makeIsoDate("2026-08-18"),
      slotType: "dinner",
      slotIndex: 0,
      filling: cookedFilling,
      state: "cooked",
      pinned: false,
    };

    const result = generateWeek({
      settings: dinnerOnlySettings,
      weekStart: WEEK_START,
      recipes: [...staples, ...rotation],
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      existingSlots: [cookedSlot],
      rng: createFakeRng(6),
    });

    const tuesday = result.slots.find((s) => s.date === makeIsoDate("2026-08-18"));
    expect(tuesday).toEqual(cookedSlot);
  });

  it("reuses the existing PlanSlotId for a regenerated (unpinned, still-planned) slot", () => {
    const existing: PlanSlot = {
      id: makePlanSlotId("existing-wednesday-dinner"),
      date: makeIsoDate("2026-08-19"),
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "recipe", recipeId: makeRecipeId("rot-0") },
      state: "planned",
      pinned: false,
    };

    const result = generateWeek({
      settings: dinnerOnlySettings,
      weekStart: WEEK_START,
      recipes: [...staples, ...rotation],
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      existingSlots: [existing],
      rng: createFakeRng(7),
    });

    const wednesday = result.slots.find((s) => s.date === makeIsoDate("2026-08-19"));
    expect(wednesday?.id).toBe("existing-wednesday-dinner");
  });
});

describe("generateWeek — empty candidate pool yields an empty filling, not a crash", () => {
  it("fills with kind empty when no in-rotation recipe matches the slot's meal tag", () => {
    const result = generateWeek({
      settings: dinnerOnlySettings,
      weekStart: WEEK_START,
      recipes: [recipe("breakfast-only", ["breakfast"], "in-rotation")],
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      rng: createFakeRng(8),
    });
    expect(result.slots.every((s) => s.filling.kind === "empty")).toBe(true);
  });
});

describe("rerollSlot", () => {
  const rotation = Array.from({ length: 8 }, (_, i) => recipe(`rot-${i}`, ["dinner"], "in-rotation"));

  function baseSlot(recipeId: string): PlanSlot {
    return {
      id: makePlanSlotId("wed-dinner"),
      date: makeIsoDate("2026-08-19"),
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "recipe", recipeId: makeRecipeId(recipeId) },
      state: "planned",
      pinned: false,
    };
  }

  it("throws when the slot is pinned", () => {
    const slot = { ...baseSlot("rot-0"), pinned: true };
    expect(() =>
      rerollSlot({
        slot,
        settings: dinnerOnlySettings,
        weekStart: WEEK_START,
        recipes: rotation,
        recipeIngredients: [],
        pastPlanSlots: [],
        weekPlacedRecipeIds: new Set(),
        weekIngredientIds: new Set(),
        expiringIngredientIds: new Set(),
        rng: createFakeRng(1),
      }),
    ).toThrow();
  });

  it("keeps id/date/slotType/slotIndex/state/pinned, only the filling changes", () => {
    const slot = baseSlot("rot-0");
    const rerolled = rerollSlot({
      slot,
      settings: dinnerOnlySettings,
      weekStart: WEEK_START,
      recipes: rotation,
      recipeIngredients: [],
      pastPlanSlots: [],
      weekPlacedRecipeIds: new Set(),
      weekIngredientIds: new Set(),
      expiringIngredientIds: new Set(),
      rng: createFakeRng(1),
    });
    expect(rerolled.id).toBe(slot.id);
    expect(rerolled.date).toBe(slot.date);
    expect(rerolled.slotType).toBe(slot.slotType);
    expect(rerolled.slotIndex).toBe(slot.slotIndex);
    expect(rerolled.state).toBe(slot.state);
    expect(rerolled.pinned).toBe(slot.pinned);
  });

  it("excludes the current recipe by default when another candidate exists", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const slot = baseSlot("rot-0");
      const rerolled = rerollSlot({
        slot,
        settings: dinnerOnlySettings,
        weekStart: WEEK_START,
        recipes: rotation,
        recipeIngredients: [],
        pastPlanSlots: [],
        weekPlacedRecipeIds: new Set(),
        weekIngredientIds: new Set(),
        expiringIngredientIds: new Set(),
        rng: createFakeRng(seed),
      });
      expect(rerolled.filling.kind === "recipe" && rerolled.filling.recipeId).not.toBe("rot-0");
    }
  });

  it("never selects a recipe already placed elsewhere this week", () => {
    const placed = new Set(rotation.slice(1).map((r) => r.id)); // everyone except rot-0
    const slot = baseSlot("rot-0");
    const rerolled = rerollSlot({
      slot,
      settings: dinnerOnlySettings,
      weekStart: WEEK_START,
      recipes: rotation,
      recipeIngredients: [],
      pastPlanSlots: [],
      weekPlacedRecipeIds: placed,
      weekIngredientIds: new Set(),
      expiringIngredientIds: new Set(),
      rng: createFakeRng(2),
    });
    // Only rot-0 (the slot's own current recipe) was not "placed elsewhere",
    // and excludeCurrentRecipe defaults to true with no other candidate, so
    // rerolling falls back to keeping it.
    expect(rerolled.filling).toEqual({ kind: "recipe", recipeId: makeRecipeId("rot-0") });
  });
});

// ---------------------------------------------------------------------------
// WP-leftover-planning
// ---------------------------------------------------------------------------

describe("generateWeek — one recipe fills every night", () => {
  it("with a single in-rotation dinner recipe, it is placed on all 7 nights", () => {
    const only = recipe("only", ["dinner"], "in-rotation");
    const result = generateWeek({
      settings: { ...dinnerOnlySettings, repeatExclusionWeeks: 0 },
      weekStart: WEEK_START,
      recipes: [only],
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      rng: createFakeRng(11),
    });
    expect(recipeFillingIds(result.slots)).toEqual(Array(7).fill("only"));
  });
});

describe("generateWeek — three recipes spread evenly once repeats are forced", () => {
  it("A B C A B C A — never A A once every recipe has had one turn", () => {
    const a = recipe("a", ["dinner"], "in-rotation");
    const b = recipe("b", ["dinner"], "in-rotation");
    const c = recipe("c", ["dinner"], "in-rotation");
    const result = generateWeek({
      settings: { ...dinnerOnlySettings, repeatExclusionWeeks: 0 },
      weekStart: WEEK_START,
      recipes: [a, b, c],
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      rng: createFakeRng(21),
    });
    const ids = recipeFillingIds(result.slots) as string[];
    expect(ids).toHaveLength(7);
    expect(new Set(ids.slice(0, 3))).toEqual(new Set(["a", "b", "c"])); // first three days: one of each, order depends on the weighted pick
    // Day 4 onward exactly repeats days 1-3 in the same order forever after
    // (the fallback always reaches for whichever recipe was used longest ago).
    expect(ids[3]).toBe(ids[0]);
    expect(ids[4]).toBe(ids[1]);
    expect(ids[5]).toBe(ids[2]);
    expect(ids[6]).toBe(ids[0]);
    // Never two days in a row with the same recipe.
    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i]).not.toBe(ids[i - 1]);
    }
  });
});

describe("generateWeek — leftovers are used first", () => {
  it("prefers an available real leftover lot over cooking a fresh in-rotation recipe", () => {
    const chili = recipe("chili", ["dinner"], "in-rotation");
    const other = recipe("other", ["dinner"], "in-rotation");
    const singleSlotSettings: Settings = {
      householdSize: 2,
      repeatExclusionWeeks: 0,
      reuseGapSlots: 0, // this test is about leftover-vs-fresh-cook priority, not the gap — see the dedicated gap-boundary describe block below
      slotLayout: [{ day: "monday", slots: ["dinner"] }],
    };
    const chiliLot = {
      id: makeLotId("lot-1"),
      ingredientId: makeIngredientId("leftover-chili"),
      quantity: makeQuantity(2, "portion" as const),
      purchaseDate: makeIsoDate("2026-08-10"), // the Monday before WEEK_START — this layout's only configured day
      location: "fridge" as const,
      expiry: makeIsoDate("2026-09-01"),
      expiryOverridden: true,
    };

    for (let seed = 0; seed < 20; seed += 1) {
      const result = generateWeek({
        settings: singleSlotSettings,
        weekStart: WEEK_START,
        recipes: [chili, other],
        recipeIngredients: [],
        pastPlanSlots: [],
        expiringIngredientIds: new Set(),
        leftoverLotsByRecipeId: new Map([[chili.id, [chiliLot]]]),
        rng: createFakeRng(seed),
      });
      expect(result.slots).toHaveLength(1);
      expect(result.slots[0]!.filling).toEqual({ kind: "leftover", lotId: chiliLot.id });
    }
  });
});

describe("generateWeek — the reuse gap is honoured exactly at its boundary", () => {
  const chili = recipe("chili", ["breakfast", "dinner"], "in-rotation");
  const otherBreakfast = recipe("other-breakfast", ["breakfast"], "in-rotation");
  const otherDinner = recipe("other-dinner", ["dinner"], "in-rotation");

  const gapSettings: Settings = {
    householdSize: 2,
    repeatExclusionWeeks: 0,
    reuseGapSlots: 2,
    slotLayout: [
      { day: "monday", slots: ["dinner"] },
      { day: "tuesday", slots: ["breakfast", "dinner"] },
      { day: "wednesday", slots: ["dinner"] },
    ],
  };

  function pinnedMondaySource(): PlanSlot {
    return {
      id: makePlanSlotId("mon-dinner"),
      date: makeIsoDate("2026-08-17"),
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "recipe", recipeId: chili.id, scaleServings: 4 }, // household 2 -> surplus 2
      state: "planned",
      pinned: true,
    };
  }

  it("Tuesday's slots (0 and 1 slots away) do not qualify; Wednesday dinner (exactly 2 away) does", () => {
    const source = pinnedMondaySource();
    const result = generateWeek({
      settings: gapSettings,
      weekStart: WEEK_START,
      recipes: [chili, otherBreakfast, otherDinner],
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      existingSlots: [source],
      leftoverShelfLifeDays: 10, // plenty of runway — expiry isn't the limiting factor in this test
      rng: createFakeRng(31),
    });

    function find(date: string, slotType: MealTag): PlanSlot {
      const slot = result.slots.find((s) => s.date === makeIsoDate(date) && s.slotType === slotType);
      if (!slot) throw new Error(`no slot found for ${date} ${slotType}`);
      return slot;
    }
    expect(find("2026-08-17", "dinner")).toEqual(source); // pinned, untouched
    expect(find("2026-08-18", "breakfast").filling.kind).not.toBe("leftover-projected");
    expect(find("2026-08-18", "dinner").filling.kind).not.toBe("leftover-projected");
    expect(find("2026-08-19", "dinner").filling).toEqual({
      kind: "leftover-projected",
      sourceSlotId: source.id,
      recipeId: chili.id,
    });
  });

  it("excludes a projected leftover that would already have expired by the qualifying slot's date", () => {
    const source = pinnedMondaySource();
    const result = generateWeek({
      settings: gapSettings,
      weekStart: WEEK_START,
      recipes: [chili, otherBreakfast, otherDinner],
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      existingSlots: [source],
      leftoverShelfLifeDays: 1, // expires 2026-08-18, before Wednesday 2026-08-19
      rng: createFakeRng(32),
    });
    const wednesday = result.slots.find((s) => s.date === makeIsoDate("2026-08-19") && s.slotType === "dinner");
    // Expired before Wednesday, so it falls through to an ordinary fresh
    // pick from the dinner pool (chili or other-dinner — either is a valid
    // in-rotation dinner candidate); the point of this test is only that it
    // is NOT the projected leftover.
    expect(wednesday!.filling.kind).toBe("recipe");
  });

  it("applies the same gap, approximately, to a REAL leftover lot — a Lot carries no PlanSlotId, only its purchaseDate", () => {
    // Same layout as above: Monday dinner(0 slots between it and itself),
    // Tuesday breakfast(0 between)/dinner(1 between), Wednesday dinner
    // (exactly 2 between) — `conservativeSourcePosition` anchors the lot on
    // Monday's LAST (and only) configured slot, same position a projected
    // source on that exact slot would use.
    const chiliLot = {
      id: makeLotId("real-lot-1"),
      ingredientId: makeIngredientId("leftover-chili"),
      quantity: makeQuantity(2, "portion" as const),
      purchaseDate: makeIsoDate("2026-08-17"), // Monday
      location: "fridge" as const,
      expiry: makeIsoDate("2026-09-01"),
      expiryOverridden: true,
    };

    const result = generateWeek({
      settings: gapSettings,
      weekStart: WEEK_START,
      recipes: [chili, otherBreakfast, otherDinner],
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      leftoverLotsByRecipeId: new Map([[chili.id, [chiliLot]]]),
      rng: createFakeRng(33),
    });

    function find(date: string, slotType: MealTag): PlanSlot {
      const slot = result.slots.find((s) => s.date === makeIsoDate(date) && s.slotType === slotType);
      if (!slot) throw new Error(`no slot found for ${date} ${slotType}`);
      return slot;
    }
    expect(find("2026-08-18", "breakfast").filling.kind).not.toBe("leftover");
    expect(find("2026-08-18", "dinner").filling.kind).not.toBe("leftover");
    expect(find("2026-08-19", "dinner").filling).toEqual({ kind: "leftover", lotId: chiliLot.id });
  });

  it("never applies the gap to a genuine shop purchase (not the leftover 'portion' unit convention)", () => {
    // Same settings as the real-leftover-lot case above, but this lot is an
    // ordinary ground-beef purchase (unit "g") purchased the very same day
    // as the week's FIRST slot (Monday dinner) — purchaseDate there means
    // "bought this day", not "cooked this day", so it is immediately
    // eligible for that very first slot, with no gap to wait out at all. A
    // "portion" lot bought/cooked that same Monday would fail the gap check
    // for Monday's own slot (0 slots between a source and itself), so
    // seeing it picked here proves the gap truly isn't applied.
    const groundBeefLot = {
      id: makeLotId("purchase-lot-1"),
      ingredientId: makeIngredientId("ground-beef"),
      quantity: makeQuantity(500, "g" as const),
      purchaseDate: makeIsoDate("2026-08-17"), // Monday — same date as the week's first slot
      location: "fridge" as const,
      expiry: makeIsoDate("2026-09-01"),
      expiryOverridden: false,
    };

    const result = generateWeek({
      settings: gapSettings,
      weekStart: WEEK_START,
      recipes: [chili, otherBreakfast, otherDinner],
      recipeIngredients: [],
      pastPlanSlots: [],
      expiringIngredientIds: new Set(),
      // Not a real caller shape (leftoverLotsByRecipeId is meant for
      // leftover-convention lots only) — used here purely to exercise
      // `pickRealLeftover`'s unit gate directly.
      leftoverLotsByRecipeId: new Map([[chili.id, [groundBeefLot]]]),
      rng: createFakeRng(34),
    });

    const mondayDinner = result.slots.find((s) => s.date === makeIsoDate("2026-08-17") && s.slotType === "dinner");
    expect(mondayDinner!.filling).toEqual({ kind: "leftover", lotId: groundBeefLot.id });
  });
});

describe("generateWeek — a chain crossing the week boundary", () => {
  it("a not-yet-cooked prior-week slot's expected surplus can feed a slot early in the following week", () => {
    const chili = recipe("chili", ["dinner"], "in-rotation");
    const other = recipe("other", ["dinner"], "in-rotation");

    const priorWeekSource: PlanSlot = {
      id: makePlanSlotId("prior-sunday-dinner"),
      date: makeIsoDate("2026-08-16"), // the Sunday before WEEK_START (2026-08-17, a Monday)
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "recipe", recipeId: chili.id, scaleServings: 4 }, // household 2 -> surplus 2
      state: "planned", // not yet cooked
      pinned: false,
    };

    const result = generateWeek({
      settings: { ...dinnerOnlySettings, householdSize: 2 }, // reuseGapSlots defaults to 2
      weekStart: WEEK_START,
      recipes: [chili, other],
      recipeIngredients: [],
      pastPlanSlots: [priorWeekSource],
      expiringIngredientIds: new Set(),
      leftoverShelfLifeDays: 10,
      rng: createFakeRng(41),
    });

    // Sunday(source) -> Monday(0 between) -> Tuesday(1 between) -> Wednesday(2 between, qualifies).
    const wednesday = result.slots.find((s) => s.date === makeIsoDate("2026-08-19"));
    expect(wednesday!.filling).toEqual({
      kind: "leftover-projected",
      sourceSlotId: priorWeekSource.id,
      recipeId: chili.id,
    });
    const monday = result.slots.find((s) => s.date === makeIsoDate("2026-08-17"));
    const tuesday = result.slots.find((s) => s.date === makeIsoDate("2026-08-18"));
    expect(monday!.filling.kind).not.toBe("leftover-projected");
    expect(tuesday!.filling.kind).not.toBe("leftover-projected");
  });

  it("never treats a SKIPPED prior-week slot as a leftover source", () => {
    const chili = recipe("chili", ["dinner"], "in-rotation");
    const other = recipe("other", ["dinner"], "in-rotation");
    const skippedSource: PlanSlot = {
      id: makePlanSlotId("prior-sunday-dinner"),
      date: makeIsoDate("2026-08-16"),
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "recipe", recipeId: chili.id, scaleServings: 4 },
      state: "skipped", // the meal never happened
      pinned: false,
    };

    const result = generateWeek({
      settings: dinnerOnlySettings,
      weekStart: WEEK_START,
      recipes: [chili, other],
      recipeIngredients: [],
      pastPlanSlots: [skippedSource],
      expiringIngredientIds: new Set(),
      leftoverShelfLifeDays: 10,
      rng: createFakeRng(42),
    });
    expect(result.slots.some((s) => s.filling.kind === "leftover-projected")).toBe(false);
  });
});

describe("setSlotPinned", () => {
  it("toggles only the pinned flag", () => {
    const slot: PlanSlot = {
      id: makePlanSlotId("s1"),
      date: makeIsoDate("2026-08-17"),
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "empty" },
      state: "planned",
      pinned: false,
    };
    expect(setSlotPinned(slot, true)).toEqual({ ...slot, pinned: true });
    expect(setSlotPinned(slot, true).id).toBe(slot.id);
  });
});
