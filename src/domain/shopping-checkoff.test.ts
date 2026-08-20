import { describe, expect, it } from "vitest";
import { makeIngredientId, makeIsoDate, makeIsoTimestamp, makeQuantity } from "./types.ts";
import { createFakeRng, createFixedClock } from "./fakes/index.ts";
import { checkOffShoppingItem } from "./shopping-checkoff.ts";
import type { CheckOffInput } from "./shopping-types.ts";

const rice = makeIngredientId("rice");
const clock = createFixedClock(makeIsoTimestamp("2026-08-20T09:00:00.000Z"), makeIsoDate("2026-08-20"));

describe("checkOffShoppingItem", () => {
  it("defaults the purchased quantity to the needed quantity", () => {
    const input: CheckOffInput = {
      ingredientId: rice,
      neededQuantity: makeQuantity(400, "g"),
      location: "pantry",
    };

    const event = checkOffShoppingItem(input, clock, createFakeRng(1));

    expect(event.type).toBe("purchase");
    expect(event.quantity).toEqual(makeQuantity(400, "g"));
  });

  it("a bigger-package actual quantity overrides the needed quantity, dated today from the Clock", () => {
    const input: CheckOffInput = {
      ingredientId: rice,
      neededQuantity: makeQuantity(400, "g"),
      actualQuantity: makeQuantity(1000, "g"),
      location: "pantry",
    };

    const event = checkOffShoppingItem(input, clock, createFakeRng(1));

    expect(event.quantity).toEqual(makeQuantity(1000, "g"));
    expect(event.purchaseDate).toBe("2026-08-20");
    expect(event.ingredientId).toBe(rice);
  });

  it("mints ids from the injected Rng, not a real generator", () => {
    const input: CheckOffInput = {
      ingredientId: rice,
      neededQuantity: makeQuantity(400, "g"),
      location: "pantry",
    };

    const a = checkOffShoppingItem(input, clock, createFakeRng(1));
    const b = checkOffShoppingItem(input, clock, createFakeRng(1));

    expect(a).toEqual(b); // same seed => same event, deterministic
  });

  it("rejects an actual quantity in a different unit than the need", () => {
    const input: CheckOffInput = {
      ingredientId: rice,
      neededQuantity: makeQuantity(400, "g"),
      actualQuantity: makeQuantity(2, "piece"),
      location: "pantry",
    };

    expect(() => checkOffShoppingItem(input, clock, createFakeRng(1))).toThrow(/Mixed units/);
  });

  it("carries an expiry override through when given", () => {
    const input: CheckOffInput = {
      ingredientId: rice,
      neededQuantity: makeQuantity(400, "g"),
      location: "pantry",
      expiryOverride: makeIsoDate("2027-01-01"),
    };

    const event = checkOffShoppingItem(input, clock, createFakeRng(1));

    expect(event.expiryOverride).toBe("2027-01-01");
  });

  it("omits expiryOverride entirely when not given (exactOptionalPropertyTypes)", () => {
    const input: CheckOffInput = {
      ingredientId: rice,
      neededQuantity: makeQuantity(400, "g"),
      location: "pantry",
    };

    const event = checkOffShoppingItem(input, clock, createFakeRng(1));

    expect("expiryOverride" in event).toBe(false);
  });
});
