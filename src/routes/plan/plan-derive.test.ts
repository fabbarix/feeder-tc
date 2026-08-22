import { describe, expect, it } from "vitest";
import {
  buildCalendarDays,
  buildSlotView,
  computeExpiringIngredientIds,
  computeIndivisibleForecast,
  computeWeekSummary,
  densityDots,
  groupSlotsByDay,
  mergeWeekSlots,
} from "./plan-derive.ts";
import {
  makeIngredientId,
  makeIsoDate,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
} from "../../domain/index.ts";
import type { Ingredient, Lot, PlanSlot, Recipe, Settings } from "../../domain/index.ts";

function recipe(id: string, status: Recipe["status"] = "in-rotation"): Recipe {
  return {
    id: makeRecipeId(id),
    name: id,
    kind: "cooked",
    baseServings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    mealTags: ["dinner"],
    status,
  };
}

function ingredient(id: string): Ingredient {
  return {
    id: makeIngredientId(id),
    name: id,
    unit: "g",
    shelfLifeDays: 10,
    openedShelfLifeDays: 5,
    defaultLocation: "pantry",
  };
}

describe("buildSlotView", () => {
  it("resolves a recipe filling's recipe", () => {
    const chili = recipe("chili");
    const slot: PlanSlot = {
      id: makePlanSlotId("s1"),
      date: makeIsoDate("2026-08-25"),
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "recipe", recipeId: chili.id },
      state: "planned",
      pinned: false,
    };
    const view = buildSlotView(
      slot,
      new Map([[chili.id, chili]]),
      new Map(),
      new Map(),
      makeIsoDate("2026-08-24"),
    );
    expect(view.recipe).toBe(chili);
    expect(view.isToday).toBe(false);
  });

  it("resolves a leftover filling's lot and ingredient, and flags today", () => {
    const leftover = ingredient("leftover-chili");
    const lot: Lot = {
      id: makeLotId("lot1"),
      ingredientId: leftover.id,
      quantity: makeQuantity(4, "portion"),
      purchaseDate: makeIsoDate("2026-08-24"),
      location: "fridge",
      expiry: makeIsoDate("2026-08-28"),
      expiryOverridden: true,
    };
    const slot: PlanSlot = {
      id: makePlanSlotId("s2"),
      date: makeIsoDate("2026-08-25"),
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "leftover", lotId: lot.id },
      state: "planned",
      pinned: false,
    };
    const view = buildSlotView(
      slot,
      new Map(),
      new Map([[leftover.id, leftover]]),
      new Map([[lot.id, lot]]),
      makeIsoDate("2026-08-25"),
    );
    expect(view.leftoverLot).toBe(lot);
    expect(view.leftoverIngredient).toBe(leftover);
    expect(view.isToday).toBe(true);
  });
});

describe("groupSlotsByDay", () => {
  it("groups by date and orders each day's slots by slotIndex", () => {
    const day = makeIsoDate("2026-08-24");
    function view(slotIndex: number): ReturnType<typeof buildSlotView> {
      const slot: PlanSlot = {
        id: makePlanSlotId(`s-${slotIndex}`),
        date: day,
        slotType: "dinner",
        slotIndex,
        filling: { kind: "empty" },
        state: "planned",
        pinned: false,
      };
      return buildSlotView(slot, new Map(), new Map(), new Map(), day);
    }
    const grouped = groupSlotsByDay([day], [view(1), view(0)]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.slots.map((v) => v.slot.slotIndex)).toEqual([0, 1]);
  });
});

describe("computeWeekSummary", () => {
  it("counts staple placements and empty slots, and surfaces the most recently excluded recipe", () => {
    const staple = recipe("sunday-roast", "staple");
    const rotation = recipe("carbonara");
    const weekStart = makeIsoDate("2026-08-24");
    const today = makeIsoDate("2026-08-24");

    const weekSlots: PlanSlot[] = [
      {
        id: makePlanSlotId("w1"),
        date: weekStart,
        slotType: "dinner",
        slotIndex: 0,
        filling: { kind: "recipe", recipeId: staple.id },
        state: "planned",
        pinned: false,
      },
      {
        id: makePlanSlotId("w2"),
        date: makeIsoDate("2026-08-25"),
        slotType: "dinner",
        slotIndex: 0,
        filling: { kind: "empty" },
        state: "planned",
        pinned: false,
      },
    ];

    const pastPlanSlots: PlanSlot[] = [
      {
        id: makePlanSlotId("p1"),
        date: makeIsoDate("2026-08-17"), // 1 week before weekStart
        slotType: "dinner",
        slotIndex: 0,
        filling: { kind: "recipe", recipeId: rotation.id },
        state: "cooked",
        pinned: false,
      },
    ];

    const recipesById = new Map([
      [staple.id, staple],
      [rotation.id, rotation],
    ]);

    const summary = computeWeekSummary(weekSlots, recipesById, pastPlanSlots, weekStart, 3, today);
    expect(summary.staplesPlaced).toBe(1);
    expect(summary.emptySlots).toBe(1);
    expect(summary.excluded).toEqual({ name: "carbonara", weeksAgo: 1 });
  });

  it("omits `excluded` when nothing was cooked recently enough to be excluded", () => {
    const weekStart = makeIsoDate("2026-08-24");
    const summary = computeWeekSummary([], new Map(), [], weekStart, 3, weekStart);
    expect(summary.excluded).toBeUndefined();
  });
});

describe("computeExpiringIngredientIds", () => {
  it("includes non-freezer lots expiring within the 7-day window", () => {
    const weekStart = makeIsoDate("2026-08-24");
    const chicken = ingredient("chicken");
    const frozenPeas = ingredient("frozen-peas");
    const lots: Lot[] = [
      {
        id: makeLotId("l1"),
        ingredientId: chicken.id,
        quantity: makeQuantity(500, "g"),
        purchaseDate: makeIsoDate("2026-08-20"),
        location: "fridge",
        expiry: makeIsoDate("2026-08-27"),
        expiryOverridden: false,
      },
      {
        id: makeLotId("l2"),
        ingredientId: frozenPeas.id,
        quantity: makeQuantity(500, "g"),
        purchaseDate: makeIsoDate("2026-08-20"),
        location: "freezer",
        expiry: makeIsoDate("2026-08-26"),
        expiryOverridden: false,
      },
    ];
    const ids = computeExpiringIngredientIds(lots, weekStart);
    expect(ids.has(chicken.id)).toBe(true);
    expect(ids.has(frozenPeas.id)).toBe(false);
  });

  it("excludes lots expiring outside the window", () => {
    const weekStart = makeIsoDate("2026-08-24");
    const rice = ingredient("rice");
    const lots: Lot[] = [
      {
        id: makeLotId("l3"),
        ingredientId: rice.id,
        quantity: makeQuantity(500, "g"),
        purchaseDate: makeIsoDate("2026-01-01"),
        location: "pantry",
        expiry: makeIsoDate("2027-01-01"),
        expiryOverridden: false,
      },
    ];
    expect(computeExpiringIngredientIds(lots, weekStart).size).toBe(0);
  });
});

describe("mergeWeekSlots", () => {
  it("fills every configured position with a placeholder empty slot when nothing has been generated yet", () => {
    const specs = [
      { date: makeIsoDate("2026-08-24"), slotType: "dinner" as const, slotIndex: 0 },
      { date: makeIsoDate("2026-08-25"), slotType: "dinner" as const, slotIndex: 0 },
    ];
    const merged = mergeWeekSlots(specs, []);
    expect(merged).toHaveLength(2);
    expect(merged.every((slot) => slot.filling.kind === "empty")).toBe(true);
    expect(merged.every((slot) => slot.state === "planned" && !slot.pinned)).toBe(true);
  });

  it("reuses an existing row for a position that already has one, verbatim", () => {
    const chili = makeRecipeId("chili");
    const spec = { date: makeIsoDate("2026-08-24"), slotType: "dinner" as const, slotIndex: 0 };
    const existingSlot: PlanSlot = {
      id: makePlanSlotId("real-id"),
      date: spec.date,
      slotType: spec.slotType,
      slotIndex: spec.slotIndex,
      filling: { kind: "recipe", recipeId: chili },
      state: "planned",
      pinned: true,
    };
    const merged = mergeWeekSlots([spec], [existingSlot]);
    expect(merged).toEqual([existingSlot]);
  });

  it("gives the same placeholder the same deterministic id every call, for the same position", () => {
    const spec = { date: makeIsoDate("2026-08-24"), slotType: "dinner" as const, slotIndex: 0 };
    const first = mergeWeekSlots([spec], []);
    const second = mergeWeekSlots([spec], []);
    expect(first[0]!.id).toBe(second[0]!.id);
  });
});

// WP-PURCHASING (DESIGN_PURCHASING.md §4/§6 last bullet) — the plan slot's
// own leftover forecast, computed the same way the Shopping route's "Why?"
// disclosure computes it.
describe("computeIndivisibleForecast", () => {
  const lasagna: Recipe = {
    id: makeRecipeId("store-lasagna"),
    name: "Store lasagna",
    kind: "bought",
    baseServings: 4,
    prepMinutes: 0,
    cookMinutes: 40,
    mealTags: ["dinner"],
    status: "in-rotation",
  };

  it("forecasts a leftover for a bought meal that doesn't divide evenly (household 2 against baseServings 4)", () => {
    const forecast = computeIndivisibleForecast(lasagna, 2);
    expect(forecast).toEqual({ units: 1, producedServings: 4, surplusServings: 2 });
  });

  it("forecasts zero surplus when servings divide evenly", () => {
    const forecast = computeIndivisibleForecast(lasagna, 4);
    expect(forecast?.surplusServings).toBe(0);
  });

  it("returns undefined for a non-indivisible (cooked) recipe", () => {
    const soup: Recipe = { ...lasagna, id: makeRecipeId("soup"), kind: "cooked" };
    expect(computeIndivisibleForecast(soup, 2)).toBeUndefined();
  });

  it("returns undefined when there's no recipe at all (e.g. a dangling reference)", () => {
    expect(computeIndivisibleForecast(undefined, 2)).toBeUndefined();
  });
});

describe("densityDots", () => {
  const day = makeIsoDate("2026-08-24");

  function viewOf(filling: PlanSlot["filling"], slotIndex: number): ReturnType<typeof buildSlotView> {
    const slot: PlanSlot = {
      id: makePlanSlotId(`s-${slotIndex}`),
      date: day,
      slotType: "dinner",
      slotIndex,
      filling,
      state: "planned",
      pinned: false,
    };
    return buildSlotView(slot, new Map(), new Map(), new Map(), day);
  }

  it("maps a recipe filling to 'filled', an empty one to 'empty', and a leftover one to 'leftover'", () => {
    const planDay = { date: day, slots: [viewOf({ kind: "recipe", recipeId: makeRecipeId("chili") }, 0)] };
    expect(densityDots(planDay)).toEqual(["filled"]);
    expect(densityDots({ date: day, slots: [viewOf({ kind: "empty" }, 0)] })).toEqual(["empty"]);
    expect(densityDots({ date: day, slots: [viewOf({ kind: "leftover", lotId: makeLotId("lot1") }, 0)] })).toEqual([
      "leftover",
    ]);
  });

  it("returns one dot per slot, in the day's existing (slotIndex) order", () => {
    const planDay = {
      date: day,
      slots: [viewOf({ kind: "empty" }, 0), viewOf({ kind: "recipe", recipeId: makeRecipeId("chili") }, 1)],
    };
    expect(densityDots(planDay)).toEqual(["empty", "filled"]);
  });

  it("returns no dots for a day with no configured slots", () => {
    expect(densityDots({ date: day, slots: [] })).toEqual([]);
  });
});

describe("buildCalendarDays", () => {
  const settings: Settings = {
    householdSize: 2,
    slotLayout: [{ day: "monday", slots: ["dinner"] }],
    repeatExclusionWeeks: 3,
    currency: "$",
  };

  it("covers a date range spanning more than one week, filling configured positions with placeholders when nothing was ever generated", () => {
    // Two Mondays, 14 days apart — only Monday has a configured slot.
    const dates = Array.from({ length: 14 }, (_, i) => makeIsoDate(`2026-08-${String(i + 1).padStart(2, "0")}`));
    const days = buildCalendarDays(dates, settings, [], new Map(), new Map(), new Map(), makeIsoDate("2026-08-01"));
    expect(days).toHaveLength(14);
    const withSlots = days.filter((d) => d.slots.length > 0);
    // 2026-08-03 and 2026-08-10 are Mondays.
    expect(withSlots.map((d) => d.date)).toEqual(["2026-08-03", "2026-08-10"]);
    expect(withSlots[0]!.slots[0]!.slot.filling.kind).toBe("empty");
  });

  it("resolves a real PlanSlot row (not a placeholder) for a position that has one, even outside a single 7-day window", () => {
    const chili = recipe("chili");
    const dates = [makeIsoDate("2026-08-10")]; // a Monday, but not a multiple of 7 by itself — exercises the offset<dates.length loop with one short trailing "chunk".
    const existing: PlanSlot = {
      id: makePlanSlotId("real"),
      date: dates[0]!,
      slotType: "dinner",
      slotIndex: 0,
      filling: { kind: "recipe", recipeId: chili.id },
      state: "planned",
      pinned: false,
    };
    const days = buildCalendarDays(
      dates,
      settings,
      [existing],
      new Map([[chili.id, chili]]),
      new Map(),
      new Map(),
      makeIsoDate("2026-08-01"),
    );
    expect(days[0]!.slots).toHaveLength(1);
    expect(days[0]!.slots[0]!.slot).toEqual(existing);
    expect(days[0]!.slots[0]!.recipe).toBe(chili);
  });
});
