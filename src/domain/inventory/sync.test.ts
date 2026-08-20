import { describe, expect, it } from "vitest";
import {
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makeQuantity,
  type Ingredient,
  type Snapshot,
  type UseEvent,
} from "../types.ts";
import { createApplyNewEvents } from "./sync.ts";

const riceId = makeIngredientId("rice");
const rice: Ingredient = {
  id: riceId,
  name: "Rice",
  unit: "g",
  shelfLifeDays: 365,
  openedShelfLifeDays: 30,
  defaultLocation: "pantry",
};
const catalog: ReadonlyMap<typeof riceId, Ingredient> = new Map([[riceId, rice]]);

describe("createApplyNewEvents", () => {
  it("BDD: a generation mismatch signals reload-required and does not fold", () => {
    const applyNewEvents = createApplyNewEvents(catalog);
    const snapshot: Snapshot = { generation: 1, cursor: 40, lots: [] };
    const outcome = applyNewEvents(snapshot, [], { schemaVersion: 1, generation: 2 });
    expect(outcome.kind).toBe("reload-required");
    if (outcome.kind === "reload-required") {
      expect(outcome.reason).toMatch(/generation/i);
    }
  });

  it("applies new events on top of the snapshot and advances the cursor by events.length", () => {
    const applyNewEvents = createApplyNewEvents(catalog);
    const snapshot: Snapshot = {
      generation: 1,
      cursor: 2,
      lots: [
        {
          id: makeLotId("lot-1"),
          ingredientId: riceId,
          quantity: makeQuantity(200, "g"),
          purchaseDate: makeIsoDate("2026-01-01"),
          location: "pantry",
          expiry: makeIsoDate("2027-01-01"),
          expiryOverridden: false,
        },
      ],
    };
    const use: UseEvent = {
      type: "use",
      id: makeEventId("evt-1"),
      timestamp: makeIsoTimestamp("2026-01-02T00:00:00Z"),
      ingredientId: riceId,
      quantity: makeQuantity(50, "g"),
    };
    const outcome = applyNewEvents(snapshot, [use], { schemaVersion: 1, generation: 1 });
    expect(outcome.kind).toBe("applied");
    if (outcome.kind === "applied") {
      expect(outcome.snapshot.generation).toBe(1);
      expect(outcome.snapshot.cursor).toBe(3);
      expect(outcome.snapshot.lots[0]?.quantity).toEqual(makeQuantity(150, "g"));
    }
  });

  it("an empty events batch is a no-op that still round-trips generation and cursor", () => {
    const applyNewEvents = createApplyNewEvents(catalog);
    const snapshot: Snapshot = { generation: 1, cursor: 5, lots: [] };
    const outcome = applyNewEvents(snapshot, [], { schemaVersion: 1, generation: 1 });
    expect(outcome).toEqual({ kind: "applied", snapshot: { generation: 1, cursor: 5, lots: [] } });
  });
});
