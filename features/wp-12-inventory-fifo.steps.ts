import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { createFixedClock } from "../src/domain/fakes/clock.ts";
import { createFakeRng } from "../src/domain/fakes/rng.ts";
import {
  createApplyNewEvents,
  createLeftoverLot,
  foldInventoryEvents,
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makeQuantity,
  type Ingredient,
  type IngredientId,
  type InventoryEvent,
  type Lot,
  type PurchaseEvent,
  type Snapshot,
} from "../src/domain/index.ts";

const feature = await loadFeature("./wp-12-inventory-fifo.feature");

let seq = 0;
function nextEventId() {
  seq += 1;
  return makeEventId(`step-evt-${seq}`);
}

describeFeature(feature, ({ Scenario }) => {
  Scenario("Partial usage accumulates against the oldest lot", ({ Given, And, When, Then }) => {
    const riceId = makeIngredientId("rice");
    const rice: Ingredient = {
      id: riceId,
      name: "Rice",
      unit: "g",
      shelfLifeDays: 365,
      openedShelfLifeDays: 30,
      defaultLocation: "pantry",
    };
    const catalog: ReadonlyMap<IngredientId, Ingredient> = new Map([[riceId, rice]]);
    const events: InventoryEvent[] = [];
    let lots: readonly Lot[] = [];

    Given("a purchase of 1000 g of rice on 2026-01-01", () => {
      events.push({
        type: "purchase",
        id: nextEventId(),
        timestamp: makeIsoTimestamp("2026-01-01T08:00:00Z"),
        ingredientId: riceId,
        lotId: makeLotId("rice-2026-01-01"),
        quantity: makeQuantity(1000, "g"),
        location: "pantry",
        purchaseDate: makeIsoDate("2026-01-01"),
      });
    });

    And("a purchase of 500 g of rice on 2026-01-10", () => {
      events.push({
        type: "purchase",
        id: nextEventId(),
        timestamp: makeIsoTimestamp("2026-01-10T08:00:00Z"),
        ingredientId: riceId,
        lotId: makeLotId("rice-2026-01-10"),
        quantity: makeQuantity(500, "g"),
        location: "pantry",
        purchaseDate: makeIsoDate("2026-01-10"),
      });
    });

    When("300 g and then 800 g of rice are used", () => {
      events.push({
        type: "use",
        id: nextEventId(),
        timestamp: makeIsoTimestamp("2026-01-15T00:00:00Z"),
        ingredientId: riceId,
        quantity: makeQuantity(300, "g"),
      });
      events.push({
        type: "use",
        id: nextEventId(),
        timestamp: makeIsoTimestamp("2026-01-16T00:00:00Z"),
        ingredientId: riceId,
        quantity: makeQuantity(800, "g"),
      });
      lots = foldInventoryEvents([], events, catalog).lots;
    });

    Then("the 2026-01-01 lot is empty", () => {
      const lot = lots.find((l) => l.id === "rice-2026-01-01");
      expect(lot?.quantity).toEqual(makeQuantity(0, "g"));
    });

    And("the 2026-01-10 lot has 400 g remaining", () => {
      const lot = lots.find((l) => l.id === "rice-2026-01-10");
      expect(lot?.quantity).toEqual(makeQuantity(400, "g"));
    });
  });

  Scenario("Opening shortens expiry", ({ Given, And, When, Then }) => {
    const tomatoId = makeIngredientId("tomato");
    let tomato: Ingredient;
    let catalog: ReadonlyMap<IngredientId, Ingredient>;
    const events: InventoryEvent[] = [];
    let lots: readonly Lot[] = [];

    Given("tomato has shelf_life_days 7 and opened_shelf_life_days 2", () => {
      tomato = {
        id: tomatoId,
        name: "Tomato",
        unit: "piece",
        shelfLifeDays: 7,
        openedShelfLifeDays: 2,
        defaultLocation: "pantry",
      };
      catalog = new Map([[tomatoId, tomato]]);
    });

    And("a lot of 1 tomato purchased on 2026-03-01", () => {
      events.push({
        type: "purchase",
        id: nextEventId(),
        timestamp: makeIsoTimestamp("2026-03-01T08:00:00Z"),
        ingredientId: tomatoId,
        lotId: makeLotId("tomato-lot"),
        quantity: makeQuantity(1, "piece"),
        location: "pantry",
        purchaseDate: makeIsoDate("2026-03-01"),
      });
    });

    When("the lot is opened on 2026-03-02", () => {
      events.push({
        type: "open",
        id: nextEventId(),
        timestamp: makeIsoTimestamp("2026-03-02T09:00:00Z"),
        ingredientId: tomatoId,
        lotId: makeLotId("tomato-lot"),
      });
      lots = foldInventoryEvents([], events, catalog).lots;
    });

    Then("its expiry becomes 2026-03-04", () => {
      expect(lots[0]?.expiry).toBe("2026-03-04");
    });
  });

  Scenario("Freezing suspends expiry", ({ Given, When, Then }) => {
    const chickenId = makeIngredientId("chicken");
    const chicken: Ingredient = {
      id: chickenId,
      name: "Chicken",
      unit: "g",
      shelfLifeDays: 3,
      openedShelfLifeDays: 1,
      defaultLocation: "fridge",
    };
    const catalog: ReadonlyMap<IngredientId, Ingredient> = new Map([[chickenId, chicken]]);
    let baseLot: Lot;
    let lots: readonly Lot[] = [];

    Given("a lot of chicken expiring 2026-03-05", () => {
      baseLot = {
        id: makeLotId("chicken-lot"),
        ingredientId: chickenId,
        quantity: makeQuantity(500, "g"),
        purchaseDate: makeIsoDate("2026-03-02"),
        location: "fridge",
        expiry: makeIsoDate("2026-03-05"),
        expiryOverridden: false,
      };
    });

    When("the lot is moved to the freezer on 2026-03-03", () => {
      const moveEvent = {
        type: "move" as const,
        id: nextEventId(),
        timestamp: makeIsoTimestamp("2026-03-03T12:00:00Z"),
        ingredientId: chickenId,
        lotId: makeLotId("chicken-lot"),
        location: "freezer" as const,
      };
      lots = foldInventoryEvents([baseLot], [moveEvent], catalog).lots;
    });

    Then("its expiry is at least 2026-09-03", () => {
      expect(lots[0]!.expiry >= "2026-09-03").toBe(true);
    });
  });

  Scenario("Generation mismatch forces full rebuild", ({ Given, When, Then }) => {
    const catalog: ReadonlyMap<IngredientId, Ingredient> = new Map();
    let snapshot: Snapshot;
    let outcome: ReturnType<ReturnType<typeof createApplyNewEvents>>;

    Given("a snapshot built at generation 1 with cursor 40", () => {
      snapshot = { generation: 1, cursor: 40, lots: [] };
    });

    When("events are applied with Meta generation 2", () => {
      const applyNewEvents = createApplyNewEvents(catalog);
      outcome = applyNewEvents(snapshot, [], { schemaVersion: 1, generation: 2 });
    });

    Then('the result signals "full reload required"', () => {
      expect(outcome.kind).toBe("reload-required");
    });
  });

  Scenario("Cooking surplus creates a leftover lot", ({ Given, Then, And }) => {
    const leftoverChiliId = makeIngredientId("leftover-chili");
    const LEFTOVER_SHELF_LIFE_DAYS = 4; // engine input, not imported from WP-16's seed catalog
    let leftoverEvent: PurchaseEvent;
    let lots: readonly Lot[] = [];

    Given(
      '"Chili" scaled to 8 servings is marked cooked for a household of 4',
      () => {
        const scaledServings = 8;
        const householdSize = 4;
        const surplusServings = scaledServings - householdSize;
        const clock = createFixedClock(
          makeIsoTimestamp("2026-03-10T18:00:00Z"),
          makeIsoDate("2026-03-10"),
        );
        const rng = createFakeRng(1);
        leftoverEvent = createLeftoverLot(
          {
            ingredientId: leftoverChiliId,
            surplusQuantity: makeQuantity(surplusServings, "portion"),
            location: "fridge",
            cookDate: clock.today(),
            shelfLifeDays: LEFTOVER_SHELF_LIFE_DAYS,
          },
          clock,
          rng,
        );
        const catalog: ReadonlyMap<IngredientId, Ingredient> = new Map(); // leftover lots never need a catalog lookup (expiryOverride is always set)
        lots = foldInventoryEvents([], [leftoverEvent], catalog).lots;
      },
    );

    Then('a lot "Leftover: Chili" of 4 portions is created in the fridge', () => {
      // "Leftover: Chili" is the display name of the catalog entry
      // `leftoverEvent.ingredientId` resolves to — Lot itself has no name
      // field (see leftovers.ts's doc comment).
      expect(leftoverEvent.ingredientId).toBe(leftoverChiliId);
      expect(lots[0]?.quantity).toEqual(makeQuantity(4, "portion"));
      expect(lots[0]?.location).toBe("fridge");
    });

    And("its expiry uses the leftover shelf-life default", () => {
      expect(lots[0]?.expiry).toBe("2026-03-14"); // 2026-03-10 + 4 days
      expect(leftoverEvent.expiryOverride).toBe("2026-03-14");
    });
  });
});
