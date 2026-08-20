import { describe, expect, it } from "vitest";
import { makeIngredientId, makeIsoDate, type Ingredient } from "../types.ts";
import { computeExpiry, DEFAULT_FREEZER_SUSPENSION_DAYS } from "./expiry.ts";

const tomato: Ingredient = {
  id: makeIngredientId("tomato"),
  name: "Tomato",
  unit: "piece",
  shelfLifeDays: 7,
  openedShelfLifeDays: 2,
  defaultLocation: "pantry",
};

describe("computeExpiry", () => {
  it("freezer branch: suspends expiry to the freezer horizon from freshReferenceDate, no ingredient needed", () => {
    const expiry = computeExpiry({
      location: "freezer",
      freshReferenceDate: makeIsoDate("2026-03-03"),
      freezerSuspensionDays: DEFAULT_FREEZER_SUSPENSION_DAYS,
    });
    // BDD: chicken moved to freezer 2026-03-03 must expire at least 2026-09-03.
    expect(expiry >= "2026-09-03").toBe(true);
  });

  it("throws when a non-frozen computation is requested without an ingredient", () => {
    expect(() =>
      computeExpiry({
        location: "pantry",
        freshReferenceDate: makeIsoDate("2026-03-01"),
        freezerSuspensionDays: DEFAULT_FREEZER_SUSPENSION_DAYS,
      }),
    ).toThrow(/ingredient.*required/i);
  });

  it("opened branch: counts openedShelfLifeDays from openedAt, ignoring freshReferenceDate", () => {
    const expiry = computeExpiry({
      location: "pantry",
      openedAt: makeIsoDate("2026-03-02"),
      freshReferenceDate: makeIsoDate("2026-01-01"), // deliberately far off; must be ignored
      freezerSuspensionDays: DEFAULT_FREEZER_SUSPENSION_DAYS,
      ingredient: tomato,
    });
    expect(expiry).toBe("2026-03-04");
  });

  it("unopened, unfrozen branch: counts shelfLifeDays from freshReferenceDate", () => {
    const expiry = computeExpiry({
      location: "pantry",
      freshReferenceDate: makeIsoDate("2026-03-01"),
      freezerSuspensionDays: DEFAULT_FREEZER_SUSPENSION_DAYS,
      ingredient: tomato,
    });
    expect(expiry).toBe("2026-03-08");
  });

  it("fridge is treated the same as pantry (not the freezer branch)", () => {
    const expiry = computeExpiry({
      location: "fridge",
      freshReferenceDate: makeIsoDate("2026-03-01"),
      freezerSuspensionDays: DEFAULT_FREEZER_SUSPENSION_DAYS,
      ingredient: tomato,
    });
    expect(expiry).toBe("2026-03-08");
  });
});
