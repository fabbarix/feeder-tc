import { describe, expect, it } from "vitest";
import { createManualClock } from "../fakes/clock.ts";
import { createFakeRng } from "../fakes/rng.ts";
import { makeIngredientId, makeIsoDate, makeIsoTimestamp, makeLotId, makeQuantity } from "../types.ts";
import {
  buildCorrectEvent,
  buildMoveEvent,
  buildOpenEvent,
  buildPurchaseEvent,
  buildSpoilEvent,
  buildUseEvent,
} from "./manual-events.ts";

const rice = makeIngredientId("rice");
const lot1 = makeLotId("lot-1");

const clock = createManualClock({
  now: makeIsoTimestamp("2026-08-20T09:00:00Z"),
  today: makeIsoDate("2026-08-20"),
});

describe("buildPurchaseEvent", () => {
  it("mints a fresh id and lotId, and omits expiryOverride when not supplied", () => {
    const event = buildPurchaseEvent(
      { ingredientId: rice, quantity: makeQuantity(500, "g"), location: "pantry", purchaseDate: makeIsoDate("2026-08-20") },
      clock,
      createFakeRng(1),
    );
    expect(event.type).toBe("purchase");
    expect(event.ingredientId).toBe(rice);
    expect(event.quantity).toEqual(makeQuantity(500, "g"));
    expect(event.location).toBe("pantry");
    expect(event.purchaseDate).toBe("2026-08-20");
    expect(event.timestamp).toBe("2026-08-20T09:00:00Z");
    expect(event.id).toBeTruthy();
    expect(event.lotId).toBeTruthy();
    expect("expiryOverride" in event).toBe(false);
  });

  it("carries expiryOverride when supplied (the add-lot form's manual expiry)", () => {
    const event = buildPurchaseEvent(
      {
        ingredientId: rice,
        quantity: makeQuantity(500, "g"),
        location: "pantry",
        purchaseDate: makeIsoDate("2026-08-20"),
        expiryOverride: makeIsoDate("2026-08-22"),
      },
      clock,
      createFakeRng(1),
    );
    expect(event.expiryOverride).toBe("2026-08-22");
  });
});

describe("buildUseEvent", () => {
  it("has no lotId field — FIFO is resolved at fold time, never chosen by the caller", () => {
    const event = buildUseEvent({ ingredientId: rice, quantity: makeQuantity(200, "g") }, clock, createFakeRng(1));
    expect(event.type).toBe("use");
    expect("lotId" in event).toBe(false);
    expect(event.quantity).toEqual(makeQuantity(200, "g"));
  });
});

describe("buildSpoilEvent", () => {
  it("names the specific lotId the user is looking at", () => {
    const event = buildSpoilEvent(
      { ingredientId: rice, lotId: lot1, quantity: makeQuantity(150, "g") },
      clock,
      createFakeRng(1),
    );
    expect(event.type).toBe("spoil");
    expect(event.lotId).toBe(lot1);
    expect(event.quantity).toEqual(makeQuantity(150, "g"));
  });
});

describe("buildMoveEvent", () => {
  it("builds a move to the given location for the given lot", () => {
    const event = buildMoveEvent({ ingredientId: rice, lotId: lot1, location: "freezer" }, clock, createFakeRng(1));
    expect(event.type).toBe("move");
    expect(event.lotId).toBe(lot1);
    expect(event.location).toBe("freezer");
  });
});

describe("buildOpenEvent", () => {
  it("builds an open event for the given lot", () => {
    const event = buildOpenEvent({ ingredientId: rice, lotId: lot1 }, clock, createFakeRng(1));
    expect(event.type).toBe("open");
    expect(event.lotId).toBe(lot1);
  });
});

describe("buildCorrectEvent", () => {
  it('is "Correct", not "Edit": always a brand-new adjust event, never mutates history', () => {
    const event = buildCorrectEvent(
      { ingredientId: rice, lotId: lot1, delta: makeQuantity(-50, "g"), reason: "counted wrong" },
      clock,
      createFakeRng(1),
    );
    expect(event.type).toBe("adjust");
    expect(event.lotId).toBe(lot1);
    expect(event.delta).toEqual(makeQuantity(-50, "g"));
    expect(event.reason).toBe("counted wrong");
  });

  it("carries an expiry override (the only way to hand-edit a lot's expiry after purchase)", () => {
    const event = buildCorrectEvent(
      { ingredientId: rice, lotId: lot1, expiry: makeIsoDate("2026-09-01") },
      clock,
      createFakeRng(1),
    );
    expect(event.expiry).toBe("2026-09-01");
    expect("delta" in event).toBe(false);
  });

  it("throws (via makeAdjustEvent) when neither delta nor expiry is supplied", () => {
    expect(() => buildCorrectEvent({ ingredientId: rice, lotId: lot1 }, clock, createFakeRng(1))).toThrow(
      /at least one/,
    );
  });
});

describe("determinism", () => {
  it("mints the same id/lotId for the same seed, and different ids for different seeds", () => {
    const input = { ingredientId: rice, quantity: makeQuantity(500, "g"), location: "pantry" as const, purchaseDate: makeIsoDate("2026-08-20") };
    const a = buildPurchaseEvent(input, clock, createFakeRng(5));
    const b = buildPurchaseEvent(input, clock, createFakeRng(5));
    const c = buildPurchaseEvent(input, clock, createFakeRng(6));
    expect(a.id).toBe(b.id);
    expect(a.lotId).toBe(b.lotId);
    expect(a.id).not.toBe(c.id);
  });
});
