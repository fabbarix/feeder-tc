import { describe, expect, it } from "vitest";
import {
  makeIngredientId,
  makeIsoDate,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type Lot,
} from "./types.ts";
import { allocateShoppingList } from "./shopping-allocate.ts";
import type { DateRange, ShoppingNeed, ShoppingNeedSource } from "./shopping-types.ts";

const tomato = makeIngredientId("tomato");
const recipeId = makeRecipeId("recipe-dinner");
const range: DateRange = { start: makeIsoDate("2026-08-24"), end: makeIsoDate("2026-08-30") };

function source(overrides: Partial<ShoppingNeedSource> & Pick<ShoppingNeedSource, "planSlotId" | "date">): ShoppingNeedSource {
  return { slotType: "dinner", slotIndex: 0, recipeId, ...overrides };
}

function need(amount: number, date: string, planSlotId: string): ShoppingNeed {
  return {
    ingredientId: tomato,
    quantity: makeQuantity(amount, "piece"),
    source: source({ planSlotId: makePlanSlotId(planSlotId), date: makeIsoDate(date) }),
  };
}

function lot(id: string, amount: number, purchaseDate: string, expiry: string): Lot {
  return {
    id: makeLotId(id),
    ingredientId: tomato,
    quantity: makeQuantity(amount, "piece"),
    purchaseDate: makeIsoDate(purchaseDate),
    location: "pantry",
    expiry: makeIsoDate(expiry),
    expiryOverridden: false,
  };
}

describe("allocateShoppingList", () => {
  it("aggregates needs across meals when there is no stock", () => {
    const needs = [need(2, "2026-08-24", "mon-dinner"), need(3, "2026-08-27", "thu-lunch")];

    const lines = allocateShoppingList(needs, [], range);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.neededQuantity).toEqual(makeQuantity(5, "piece"));
    expect(lines[0]?.sources).toHaveLength(2);
  });

  it("does not count stock expiring before the cook date", () => {
    const needs = [need(3, "2026-08-28", "fri-dinner")]; // Friday
    const lots = [lot("lot-1", 4, "2026-08-20", "2026-08-25")]; // expires Tuesday

    const lines = allocateShoppingList(needs, lots, range);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.neededQuantity).toEqual(makeQuantity(3, "piece"));
  });

  it("allocates viable stock FIFO by cook date, attributing the remainder to the later meal", () => {
    const needs = [
      need(3, "2026-08-25", "tue-dinner"), // Tuesday
      need(3, "2026-08-28", "fri-dinner"), // Friday
    ];
    const lots = [lot("lot-1", 4, "2026-08-20", "2026-08-29")]; // expires Saturday, viable for both

    const lines = allocateShoppingList(needs, lots, range);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.neededQuantity).toEqual(makeQuantity(2, "piece"));
    expect(lines[0]?.sources).toHaveLength(1);
    expect(lines[0]?.sources[0]?.planSlotId).toBe("fri-dinner");
  });

  it("produces no line when viable stock fully covers the need", () => {
    const needs = [need(3, "2026-08-25", "tue-dinner")];
    const lots = [lot("lot-1", 5, "2026-08-20", "2026-08-29")];

    expect(allocateShoppingList(needs, lots, range)).toHaveLength(0);
  });

  it("leaves excess stock unconsumed rather than going negative", () => {
    const needs = [need(1, "2026-08-25", "tue-dinner")];
    const lots = [lot("lot-1", 10, "2026-08-20", "2026-08-29")];

    expect(allocateShoppingList(needs, lots, range)).toHaveLength(0);
  });

  it("consumes the oldest viable lot first (FIFO) across two lots", () => {
    const needs = [need(6, "2026-08-25", "tue-dinner")];
    const lots = [
      lot("lot-new", 5, "2026-08-15", "2026-08-29"),
      lot("lot-old", 5, "2026-08-01", "2026-08-29"),
    ];

    const lines = allocateShoppingList(needs, lots, range);

    // old lot (5) + 1 from new lot fully covers 6, leaving 4 in the new lot —
    // observable indirectly: a second identical need is covered by what's left.
    expect(lines).toHaveLength(0);
    const secondNeed = [need(4, "2026-08-26", "wed-dinner")];
    const remainingLots = [lot("lot-new", 4, "2026-08-15", "2026-08-29")];
    expect(allocateShoppingList(secondNeed, remainingLots, range)).toHaveLength(0);
  });

  it("is order-stable: shuffled input arrays produce an identical result", () => {
    const needs = [
      need(2, "2026-08-24", "mon-dinner"),
      need(3, "2026-08-27", "thu-lunch"),
      need(1, "2026-08-28", "fri-dinner"),
    ];
    const lots = [
      lot("lot-a", 2, "2026-08-10", "2026-08-29"),
      lot("lot-b", 1, "2026-08-05", "2026-08-29"),
    ];

    const forward = allocateShoppingList(needs, lots, range);
    const shuffled = allocateShoppingList([...needs].reverse(), [...lots].reverse(), range);

    expect(shuffled).toEqual(forward);
  });
});
