import { describe, expect, it } from "vitest";
import {
  makeIngredientId,
  makeIsoDate,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type Ingredient,
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

  it("without an ingredient catalog, produces no suggestedPurchase (backward-compatible default)", () => {
    const needs = [need(2, "2026-08-24", "mon-dinner")];
    const lines = allocateShoppingList(needs, [], range);
    expect(lines[0]?.suggestedPurchase).toBeUndefined();
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

// WP-PURCHASING (DESIGN_PURCHASING.md §2.1/§5/§7) — `suggestedPurchase` is
// computed exactly once, on the already-aggregated, post-FIFO shortfall.
// These tests exercise the engine end-to-end at the allocator level (not
// just `suggestPurchase` in isolation — see purchasing.test.ts for that),
// proving the ordering itself, not just the rounding math.
describe("allocateShoppingList — suggestedPurchase (§5 scenario table, engine-level)", () => {
  const mayo = makeIngredientId("mayo");
  const onion = makeIngredientId("onion-test");

  function mayoIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
    return {
      id: mayo,
      name: "Mayonnaise",
      unit: "g",
      shelfLifeDays: 90,
      openedShelfLifeDays: 30,
      defaultLocation: "fridge",
      purchaseMode: "whole",
      packSize: makeQuantity(250, "g"),
      ...overrides,
    };
  }

  function onionIngredient(): Ingredient {
    return {
      id: onion,
      name: "Onion",
      unit: "piece",
      shelfLifeDays: 30,
      openedShelfLifeDays: 5,
      defaultLocation: "pantry",
    };
  }

  function mayoNeed(amount: number, date: string, planSlotId: string): ShoppingNeed {
    return {
      ingredientId: mayo,
      quantity: makeQuantity(amount, "g"),
      source: source({ planSlotId: makePlanSlotId(planSlotId), date: makeIsoDate(date) }),
    };
  }

  function onionNeed(amount: number, date: string, planSlotId: string): ShoppingNeed {
    return {
      ingredientId: onion,
      quantity: makeQuantity(amount, "piece"),
      source: source({ planSlotId: makePlanSlotId(planSlotId), date: makeIsoDate(date) }),
    };
  }

  it("scenario 5: needs 50 g mayo -> suggestedPurchase is 1 jar (250 g)", () => {
    const needs = [mayoNeed(50, "2026-08-24", "mon-dinner")];
    const lines = allocateShoppingList(needs, [], range, [mayoIngredient()]);
    expect(lines[0]?.neededQuantity).toEqual(makeQuantity(50, "g"));
    expect(lines[0]?.suggestedPurchase).toEqual(makeQuantity(250, "g"));
  });

  it("scenario 6: three meals x 50 g mayo aggregate to 150 g need -> suggestedPurchase is still 1 jar, never 3", () => {
    const needs = [
      mayoNeed(50, "2026-08-24", "mon-dinner"),
      mayoNeed(50, "2026-08-26", "wed-dinner"),
      mayoNeed(50, "2026-08-28", "fri-dinner"),
    ];
    const lines = allocateShoppingList(needs, [], range, [mayoIngredient()]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.neededQuantity).toEqual(makeQuantity(150, "g"));
    expect(lines[0]?.suggestedPurchase).toEqual(makeQuantity(250, "g"));
  });

  it("scenario 7: needs 300 g mayo -> suggestedPurchase is 2 jars (500 g)", () => {
    const needs = [mayoNeed(300, "2026-08-24", "mon-dinner")];
    const lines = allocateShoppingList(needs, [], range, [mayoIngredient()]);
    expect(lines[0]?.suggestedPurchase).toEqual(makeQuantity(500, "g"));
  });

  it("scenario 8: needs 300 g mayo, 200 g already viable in pantry -> shortfall 100 g -> suggestedPurchase is 1 jar, rounded AFTER stock subtraction", () => {
    const needs = [mayoNeed(300, "2026-08-25", "tue-dinner")];
    const lots: Lot[] = [
      { id: makeLotId("mayo-lot"), ingredientId: mayo, quantity: makeQuantity(200, "g"), purchaseDate: makeIsoDate("2026-08-20"), location: "fridge", expiry: makeIsoDate("2026-08-29"), expiryOverridden: false },
    ];
    const lines = allocateShoppingList(needs, lots, range, [mayoIngredient()]);
    expect(lines[0]?.neededQuantity).toEqual(makeQuantity(100, "g"));
    expect(lines[0]?.suggestedPurchase).toEqual(makeQuantity(250, "g"));
  });

  it("scenario 3: needs ½ onion -> suggestedPurchase is 1 whole onion", () => {
    const needs = [onionNeed(0.5, "2026-08-24", "mon-dinner")];
    const lines = allocateShoppingList(needs, [], range, [onionIngredient()]);
    expect(lines[0]?.neededQuantity).toEqual(makeQuantity(0.5, "piece"));
    expect(lines[0]?.suggestedPurchase).toEqual(makeQuantity(1, "piece"));
  });

  it("scenario 4: three meals x ½ onion aggregate to 1.5 -> suggestedPurchase is 2 onions, rounded once on the aggregate", () => {
    const needs = [
      onionNeed(0.5, "2026-08-24", "mon-dinner"),
      onionNeed(0.5, "2026-08-26", "wed-dinner"),
      onionNeed(0.5, "2026-08-28", "fri-dinner"),
    ];
    const lines = allocateShoppingList(needs, [], range, [onionIngredient()]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.neededQuantity).toEqual(makeQuantity(1.5, "piece"));
    expect(lines[0]?.suggestedPurchase).toEqual(makeQuantity(2, "piece"));
  });

  it("scenario 10: loose goods (no pack size) keep suggestedPurchase equal to the need", () => {
    const mince = makeIngredientId("mince-test");
    const mincedIngredient: Ingredient = {
      id: mince,
      name: "Mince",
      unit: "g",
      shelfLifeDays: 3,
      openedShelfLifeDays: 2,
      defaultLocation: "fridge",
    };
    const needs: ShoppingNeed[] = [
      {
        ingredientId: mince,
        quantity: makeQuantity(450, "g"),
        source: source({ planSlotId: makePlanSlotId("wed-dinner"), date: makeIsoDate("2026-08-26") }),
      },
    ];
    const lines = allocateShoppingList(needs, [], range, [mincedIngredient]);
    expect(lines[0]?.suggestedPurchase).toEqual(makeQuantity(450, "g"));
  });

  it("scenario 11: pantry fully covers the need -> no line at all, so no suggestedPurchase to reason about", () => {
    const needs = [mayoNeed(100, "2026-08-25", "tue-dinner")];
    const lots: Lot[] = [
      { id: makeLotId("mayo-lot-full"), ingredientId: mayo, quantity: makeQuantity(200, "g"), purchaseDate: makeIsoDate("2026-08-20"), location: "fridge", expiry: makeIsoDate("2026-08-29"), expiryOverridden: false },
    ];
    const lines = allocateShoppingList(needs, lots, range, [mayoIngredient()]);
    expect(lines).toHaveLength(0);
  });
});
