import { describe, expect, it } from "vitest";
import {
  makeAdjustEvent,
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makeQuantity,
  type Ingredient,
  type InventoryEvent,
  type Lot,
  type MoveEvent,
  type OpenEvent,
  type PurchaseEvent,
  type SpoilEvent,
  type UseEvent,
} from "../types.ts";
import { foldInventoryEvents } from "./fold.ts";
import { DEFAULT_FREEZER_SUSPENSION_DAYS } from "./expiry.ts";

const riceId = makeIngredientId("rice");
const tomatoId = makeIngredientId("tomato");
const chickenId = makeIngredientId("chicken");

const rice: Ingredient = {
  id: riceId,
  name: "Rice",
  unit: "g",
  shelfLifeDays: 365,
  openedShelfLifeDays: 30,
  defaultLocation: "pantry",
};

const tomato: Ingredient = {
  id: tomatoId,
  name: "Tomato",
  unit: "piece",
  shelfLifeDays: 7,
  openedShelfLifeDays: 2,
  defaultLocation: "pantry",
};

const chicken: Ingredient = {
  id: chickenId,
  name: "Chicken",
  unit: "g",
  shelfLifeDays: 3,
  openedShelfLifeDays: 1,
  defaultLocation: "fridge",
};

const catalog: ReadonlyMap<typeof riceId, Ingredient> = new Map([
  [riceId, rice],
  [tomatoId, tomato],
  [chickenId, chicken],
]);

let seq = 0;
function eventId(): ReturnType<typeof makeEventId> {
  seq += 1;
  return makeEventId(`evt-${seq}`);
}

function purchase(over: Partial<PurchaseEvent> & Pick<PurchaseEvent, "ingredientId" | "lotId" | "quantity" | "location" | "purchaseDate">): PurchaseEvent {
  return {
    type: "purchase",
    id: eventId(),
    timestamp: makeIsoTimestamp("2026-03-01T08:00:00Z"),
    ...over,
  };
}

describe("foldInventoryEvents — purchase", () => {
  it("computes expiry from catalog defaults when no override is given", () => {
    const event = purchase({
      ingredientId: tomatoId,
      lotId: makeLotId("lot-1"),
      quantity: makeQuantity(1, "piece"),
      location: "pantry",
      purchaseDate: makeIsoDate("2026-03-01"),
    });
    const { lots, warnings } = foldInventoryEvents([], [event], catalog);
    expect(warnings).toEqual([]);
    expect(lots).toEqual([
      {
        id: makeLotId("lot-1"),
        ingredientId: tomatoId,
        quantity: makeQuantity(1, "piece"),
        purchaseDate: makeIsoDate("2026-03-01"),
        location: "pantry",
        expiry: "2026-03-08",
        expiryOverridden: false,
      },
    ]);
  });

  it("uses expiryOverride verbatim and marks the lot expiryOverridden", () => {
    const event = purchase({
      ingredientId: tomatoId,
      lotId: makeLotId("lot-1"),
      quantity: makeQuantity(1, "piece"),
      location: "pantry",
      purchaseDate: makeIsoDate("2026-03-01"),
      expiryOverride: makeIsoDate("2026-04-01"),
    });
    const { lots } = foldInventoryEvents([], [event], catalog);
    expect(lots[0]?.expiry).toBe("2026-04-01");
    expect(lots[0]?.expiryOverridden).toBe(true);
  });

  it("purchasing directly into the freezer needs no catalog entry", () => {
    const unknownId = makeIngredientId("mystery-meat");
    const event = purchase({
      ingredientId: unknownId,
      lotId: makeLotId("lot-1"),
      quantity: makeQuantity(500, "g"),
      location: "freezer",
      purchaseDate: makeIsoDate("2026-03-01"),
    });
    const { lots } = foldInventoryEvents([], [event], catalog);
    expect(lots[0]!.expiry >= "2026-09-01").toBe(true);
    expect(lots[0]?.expiryOverridden).toBe(false);
  });

  it("throws when a non-frozen purchase references an ingredient missing from the catalog", () => {
    const unknownId = makeIngredientId("mystery-meat");
    const event = purchase({
      ingredientId: unknownId,
      lotId: makeLotId("lot-1"),
      quantity: makeQuantity(500, "g"),
      location: "pantry",
      purchaseDate: makeIsoDate("2026-03-01"),
    });
    expect(() => foldInventoryEvents([], [event], catalog)).toThrow(/unknown ingredientId/);
  });

  it("a later purchase event for the same lotId overwrites (idempotent replay of an identical purchase)", () => {
    const event = purchase({
      ingredientId: riceId,
      lotId: makeLotId("lot-1"),
      quantity: makeQuantity(500, "g"),
      location: "pantry",
      purchaseDate: makeIsoDate("2026-01-01"),
    });
    const { lots } = foldInventoryEvents([], [event, event], catalog);
    expect(lots).toHaveLength(1);
  });
});

describe("foldInventoryEvents — use (FIFO, BDD scenario)", () => {
  it("BDD: partial usage accumulates against the oldest lot", () => {
    const p1 = purchase({
      ingredientId: riceId,
      lotId: makeLotId("old"),
      quantity: makeQuantity(1000, "g"),
      location: "pantry",
      purchaseDate: makeIsoDate("2026-01-01"),
    });
    const p2 = purchase({
      ingredientId: riceId,
      lotId: makeLotId("new"),
      quantity: makeQuantity(500, "g"),
      location: "pantry",
      purchaseDate: makeIsoDate("2026-01-10"),
    });
    const use1: UseEvent = {
      type: "use",
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-15T00:00:00Z"),
      ingredientId: riceId,
      quantity: makeQuantity(300, "g"),
    };
    const use2: UseEvent = {
      type: "use",
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-16T00:00:00Z"),
      ingredientId: riceId,
      quantity: makeQuantity(800, "g"),
    };
    const { lots, warnings } = foldInventoryEvents([], [p1, p2, use1, use2], catalog);
    expect(warnings).toEqual([]);
    const oldLot = lots.find((l) => l.id === "old");
    const newLot = lots.find((l) => l.id === "new");
    expect(oldLot?.quantity).toEqual(makeQuantity(0, "g"));
    expect(newLot?.quantity).toEqual(makeQuantity(400, "g"));
  });

  it("warns (but does not throw) on over-consumption and clamps stock at zero", () => {
    const p1 = purchase({
      ingredientId: riceId,
      lotId: makeLotId("only"),
      quantity: makeQuantity(100, "g"),
      location: "pantry",
      purchaseDate: makeIsoDate("2026-01-01"),
    });
    const use: UseEvent = {
      type: "use",
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-02T00:00:00Z"),
      ingredientId: riceId,
      quantity: makeQuantity(150, "g"),
    };
    const { lots, warnings } = foldInventoryEvents([], [p1, use], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(0, "g"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.reason).toMatch(/exceeds available stock by 50 g/);
  });

  it("using an ingredient with zero lots produces full shortfall and no lot mutation", () => {
    const use: UseEvent = {
      type: "use",
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-02T00:00:00Z"),
      ingredientId: riceId,
      quantity: makeQuantity(50, "g"),
    };
    const { lots, warnings } = foldInventoryEvents([], [use], catalog);
    expect(lots).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

describe("foldInventoryEvents — spoil", () => {
  const baseLot: Lot = {
    id: makeLotId("lot-1"),
    ingredientId: riceId,
    quantity: makeQuantity(100, "g"),
    purchaseDate: makeIsoDate("2026-01-01"),
    location: "pantry",
    expiry: makeIsoDate("2027-01-01"),
    expiryOverridden: false,
  };

  function spoilEvent(over: Partial<SpoilEvent>): SpoilEvent {
    return {
      type: "spoil",
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-05T00:00:00Z"),
      ingredientId: riceId,
      lotId: makeLotId("lot-1"),
      quantity: makeQuantity(20, "g"),
      ...over,
    };
  }

  it("reduces the named lot's quantity", () => {
    const { lots, warnings } = foldInventoryEvents([baseLot], [spoilEvent({})], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(80, "g"));
    expect(warnings).toEqual([]);
  });

  it("warns and skips when the lot id is unknown", () => {
    const event = spoilEvent({ lotId: makeLotId("missing") });
    const { lots, warnings } = foldInventoryEvents([baseLot], [event], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(100, "g"));
    expect(warnings[0]?.reason).toMatch(/unknown lot/);
  });

  it("warns and skips on a mixed-unit spoil event", () => {
    const event = spoilEvent({ quantity: makeQuantity(1, "piece") });
    const { lots, warnings } = foldInventoryEvents([baseLot], [event], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(100, "g"));
    expect(warnings[0]?.reason).toMatch(/does not match lot unit/);
  });

  it("warns and clamps at zero when spoiling more than remains", () => {
    const event = spoilEvent({ quantity: makeQuantity(500, "g") });
    const { lots, warnings } = foldInventoryEvents([baseLot], [event], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(0, "g"));
    expect(warnings[0]?.reason).toMatch(/exceeds lot's remaining/);
  });
});

describe("foldInventoryEvents — adjust", () => {
  const baseLot: Lot = {
    id: makeLotId("lot-1"),
    ingredientId: riceId,
    quantity: makeQuantity(100, "g"),
    purchaseDate: makeIsoDate("2026-01-01"),
    location: "pantry",
    expiry: makeIsoDate("2027-01-01"),
    expiryOverridden: false,
  };

  it("warns and skips when the lot id is unknown", () => {
    const event = makeAdjustEvent({
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-05T00:00:00Z"),
      ingredientId: riceId,
      lotId: makeLotId("missing"),
      delta: makeQuantity(10, "g"),
    });
    const { lots, warnings } = foldInventoryEvents([baseLot], [event], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(100, "g"));
    expect(warnings[0]?.reason).toMatch(/unknown lot/);
  });

  it("applies a positive delta", () => {
    const event = makeAdjustEvent({
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-05T00:00:00Z"),
      ingredientId: riceId,
      lotId: makeLotId("lot-1"),
      delta: makeQuantity(50, "g"),
    });
    const { lots, warnings } = foldInventoryEvents([baseLot], [event], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(150, "g"));
    expect(warnings).toEqual([]);
  });

  it("applies a negative delta and clamps at zero with a warning when it overshoots", () => {
    const event = makeAdjustEvent({
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-05T00:00:00Z"),
      ingredientId: riceId,
      lotId: makeLotId("lot-1"),
      delta: makeQuantity(-500, "g"),
    });
    const { lots, warnings } = foldInventoryEvents([baseLot], [event], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(0, "g"));
    expect(warnings[0]?.reason).toMatch(/would drive lot .* negative/);
  });

  it("negative delta that does not overshoot produces no warning", () => {
    const event = makeAdjustEvent({
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-05T00:00:00Z"),
      ingredientId: riceId,
      lotId: makeLotId("lot-1"),
      delta: makeQuantity(-30, "g"),
    });
    const { lots, warnings } = foldInventoryEvents([baseLot], [event], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(70, "g"));
    expect(warnings).toEqual([]);
  });

  it("warns and leaves quantity untouched on a mixed-unit delta", () => {
    const event = makeAdjustEvent({
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-05T00:00:00Z"),
      ingredientId: riceId,
      lotId: makeLotId("lot-1"),
      delta: makeQuantity(1, "piece"),
    });
    const { lots, warnings } = foldInventoryEvents([baseLot], [event], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(100, "g"));
    expect(warnings[0]?.reason).toMatch(/does not match lot unit/);
  });

  it("BDD-adjacent: an expiry correction sets expiryOverridden = true, the only post-purchase path that can", () => {
    const event = makeAdjustEvent({
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-05T00:00:00Z"),
      ingredientId: riceId,
      lotId: makeLotId("lot-1"),
      expiry: makeIsoDate("2026-02-01"),
    });
    const { lots } = foldInventoryEvents([baseLot], [event], catalog);
    expect(lots[0]?.expiry).toBe("2026-02-01");
    expect(lots[0]?.expiryOverridden).toBe(true);
  });

  it("applies both a delta and an expiry correction from the same event", () => {
    const event = makeAdjustEvent({
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-05T00:00:00Z"),
      ingredientId: riceId,
      lotId: makeLotId("lot-1"),
      delta: makeQuantity(-10, "g"),
      expiry: makeIsoDate("2026-02-01"),
    });
    const { lots } = foldInventoryEvents([baseLot], [event], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(90, "g"));
    expect(lots[0]?.expiry).toBe("2026-02-01");
    expect(lots[0]?.expiryOverridden).toBe(true);
  });
});

describe("foldInventoryEvents — move (BDD: freezing suspends expiry)", () => {
  function chickenLot(over: Partial<Lot> = {}): Lot {
    return {
      id: makeLotId("lot-1"),
      ingredientId: chickenId,
      quantity: makeQuantity(500, "g"),
      purchaseDate: makeIsoDate("2026-03-01"),
      location: "fridge",
      expiry: makeIsoDate("2026-03-05"),
      expiryOverridden: false,
      ...over,
    };
  }

  function moveEvent(over: Partial<MoveEvent>): MoveEvent {
    return {
      type: "move",
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-03-03T12:00:00Z"),
      ingredientId: chickenId,
      lotId: makeLotId("lot-1"),
      location: "freezer",
      ...over,
    };
  }

  it("warns and skips when the lot id is unknown", () => {
    const event = moveEvent({ lotId: makeLotId("missing") });
    const { lots, warnings } = foldInventoryEvents([chickenLot()], [event], catalog);
    expect(lots[0]?.location).toBe("fridge");
    expect(warnings[0]?.reason).toMatch(/unknown lot/);
  });

  it("BDD: moving to the freezer suspends expiry to at least +6 months, and clears expiryOverridden", () => {
    const lot = chickenLot({ expiryOverridden: true }); // simulate a prior manual override
    const { lots } = foldInventoryEvents([lot], [moveEvent({})], catalog);
    expect(lots[0]?.location).toBe("freezer");
    expect(lots[0]!.expiry >= "2026-09-03").toBe(true);
    expect(lots[0]?.expiryOverridden).toBe(false);
  });

  it("thaw: moving out of the freezer recomputes a fresh unopened countdown from the move date", () => {
    const frozen = chickenLot({ location: "freezer", expiry: makeIsoDate("2026-09-01") });
    const event = moveEvent({ location: "fridge", timestamp: makeIsoTimestamp("2026-08-01T00:00:00Z") });
    const { lots } = foldInventoryEvents([frozen], [event], catalog);
    expect(lots[0]?.location).toBe("fridge");
    // chicken shelfLifeDays = 3, from the move (thaw) date 2026-08-01.
    expect(lots[0]?.expiry).toBe("2026-08-04");
    expect(lots[0]?.expiryOverridden).toBe(false);
  });

  it("thaw: an opened lot keeps counting from its original openedAt, not the thaw date", () => {
    const frozen = chickenLot({
      location: "freezer",
      openedAt: makeIsoDate("2026-07-01"),
      expiry: makeIsoDate("2026-09-01"),
    });
    const event = moveEvent({ location: "fridge", timestamp: makeIsoTimestamp("2026-08-01T00:00:00Z") });
    const { lots } = foldInventoryEvents([frozen], [event], catalog);
    // chicken openedShelfLifeDays = 1, from openedAt 2026-07-01.
    expect(lots[0]?.expiry).toBe("2026-07-02");
  });

  it("thawing throws if the catalog is missing the ingredient (no fixed horizon to fall back on)", () => {
    const unknownId = makeIngredientId("mystery-meat");
    const frozen: Lot = {
      id: makeLotId("lot-1"),
      ingredientId: unknownId,
      quantity: makeQuantity(500, "g"),
      purchaseDate: makeIsoDate("2026-03-01"),
      location: "freezer",
      expiry: makeIsoDate("2026-09-01"),
      expiryOverridden: false,
    };
    const event: MoveEvent = {
      type: "move",
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-08-01T00:00:00Z"),
      ingredientId: unknownId,
      lotId: makeLotId("lot-1"),
      location: "fridge",
    };
    expect(() => foldInventoryEvents([frozen], [event], catalog)).toThrow(/unknown ingredientId/);
  });

  it("a move between two non-freezer locations relocates the lot without touching expiry", () => {
    const lot = chickenLot({ location: "pantry", expiry: makeIsoDate("2026-03-05") });
    const event = moveEvent({ location: "fridge" });
    const { lots } = foldInventoryEvents([lot], [event], catalog);
    expect(lots[0]?.location).toBe("fridge");
    expect(lots[0]?.expiry).toBe("2026-03-05");
  });

  it("a no-op move (freezer to freezer) also leaves expiry untouched", () => {
    const lot = chickenLot({ location: "freezer", expiry: makeIsoDate("2026-09-01") });
    const event = moveEvent({ location: "freezer" });
    const { lots } = foldInventoryEvents([lot], [event], catalog);
    expect(lots[0]?.location).toBe("freezer");
    expect(lots[0]?.expiry).toBe("2026-09-01");
  });
});

describe("foldInventoryEvents — open (BDD: opening shortens expiry)", () => {
  function tomatoLot(over: Partial<Lot> = {}): Lot {
    return {
      id: makeLotId("lot-1"),
      ingredientId: tomatoId,
      quantity: makeQuantity(1, "piece"),
      purchaseDate: makeIsoDate("2026-03-01"),
      location: "pantry",
      expiry: makeIsoDate("2026-03-08"),
      expiryOverridden: false,
      ...over,
    };
  }

  function openEvent(over: Partial<OpenEvent> = {}): OpenEvent {
    return {
      type: "open",
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-03-02T09:00:00Z"),
      ingredientId: tomatoId,
      lotId: makeLotId("lot-1"),
      ...over,
    };
  }

  it("warns and skips when the lot id is unknown", () => {
    const event = openEvent({ lotId: makeLotId("missing") });
    const { lots, warnings } = foldInventoryEvents([tomatoLot()], [event], catalog);
    expect(lots[0]?.openedAt).toBeUndefined();
    expect(warnings[0]?.reason).toMatch(/unknown lot/);
  });

  it("BDD: opening shortens expiry to openedAt + openedShelfLifeDays", () => {
    const { lots, warnings } = foldInventoryEvents([tomatoLot()], [openEvent()], catalog);
    expect(lots[0]?.openedAt).toBe("2026-03-02");
    expect(lots[0]?.expiry).toBe("2026-03-04");
    expect(lots[0]?.expiryOverridden).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("warns and is a no-op on a duplicate open event", () => {
    const opened = tomatoLot({ openedAt: makeIsoDate("2026-03-02"), expiry: makeIsoDate("2026-03-04") });
    const event = openEvent({ timestamp: makeIsoTimestamp("2026-03-03T09:00:00Z") });
    const { lots, warnings } = foldInventoryEvents([opened], [event], catalog);
    expect(lots[0]?.openedAt).toBe("2026-03-02");
    expect(lots[0]?.expiry).toBe("2026-03-04");
    expect(warnings[0]?.reason).toMatch(/already opened/);
  });

  it("opening a frozen lot records openedAt without touching the suspended expiry", () => {
    const frozen = tomatoLot({ location: "freezer", expiry: makeIsoDate("2026-09-01") });
    const { lots } = foldInventoryEvents([frozen], [openEvent()], catalog);
    expect(lots[0]?.openedAt).toBe("2026-03-02");
    expect(lots[0]?.expiry).toBe("2026-09-01");
  });

  it("throws when opening a non-frozen lot whose ingredient is missing from the catalog", () => {
    const unknownId = makeIngredientId("mystery-meat");
    const lot: Lot = {
      id: makeLotId("lot-1"),
      ingredientId: unknownId,
      quantity: makeQuantity(1, "piece"),
      purchaseDate: makeIsoDate("2026-03-01"),
      location: "pantry",
      expiry: makeIsoDate("2026-03-08"),
      expiryOverridden: false,
    };
    const event: OpenEvent = {
      type: "open",
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-03-02T09:00:00Z"),
      ingredientId: unknownId,
      lotId: makeLotId("lot-1"),
    };
    expect(() => foldInventoryEvents([lot], [event], catalog)).toThrow(/unknown ingredientId/);
  });
});

describe("foldInventoryEvents — cross-cutting", () => {
  it("processes every event type in one pass and honours a custom freezerSuspensionDays option", () => {
    const events: InventoryEvent[] = [
      purchase({
        ingredientId: riceId,
        lotId: makeLotId("lot-1"),
        quantity: makeQuantity(200, "g"),
        location: "pantry",
        purchaseDate: makeIsoDate("2026-01-01"),
      }),
      {
        type: "use",
        id: eventId(),
        timestamp: makeIsoTimestamp("2026-01-02T00:00:00Z"),
        ingredientId: riceId,
        quantity: makeQuantity(10, "g"),
      },
      {
        type: "move",
        id: eventId(),
        timestamp: makeIsoTimestamp("2026-01-03T00:00:00Z"),
        ingredientId: riceId,
        lotId: makeLotId("lot-1"),
        location: "freezer",
      },
    ];
    const { lots } = foldInventoryEvents([], events, catalog, { freezerSuspensionDays: 10 });
    expect(lots[0]?.quantity).toEqual(makeQuantity(190, "g"));
    expect(lots[0]?.expiry).toBe("2026-01-13");
  });

  it("starting from a non-empty base snapshot folds new events on top of it", () => {
    const base: Lot[] = [
      {
        id: makeLotId("lot-1"),
        ingredientId: riceId,
        quantity: makeQuantity(200, "g"),
        purchaseDate: makeIsoDate("2026-01-01"),
        location: "pantry",
        expiry: makeIsoDate("2027-01-01"),
        expiryOverridden: false,
      },
    ];
    const use: UseEvent = {
      type: "use",
      id: eventId(),
      timestamp: makeIsoTimestamp("2026-01-02T00:00:00Z"),
      ingredientId: riceId,
      quantity: makeQuantity(50, "g"),
    };
    const { lots } = foldInventoryEvents(base, [use], catalog);
    expect(lots[0]?.quantity).toEqual(makeQuantity(150, "g"));
  });

  it("uses the default freezer suspension when no option is passed", () => {
    const events: InventoryEvent[] = [
      purchase({
        ingredientId: riceId,
        lotId: makeLotId("lot-1"),
        quantity: makeQuantity(200, "g"),
        location: "freezer",
        purchaseDate: makeIsoDate("2026-01-01"),
      }),
    ];
    const { lots } = foldInventoryEvents([], events, catalog);
    expect(lots[0]?.expiry).toBe(
      (() => {
        // Cross-check against the exported default rather than hardcoding a date.
        const d = new Date(Date.UTC(2026, 0, 1) + DEFAULT_FREEZER_SUSPENSION_DAYS * 86_400_000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      })(),
    );
  });
});
