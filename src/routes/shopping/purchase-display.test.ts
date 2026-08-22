/**
 * `purchase-display.ts` tests, focused on `formatBuyPrimary` —
 * `Ingredient.packLabel`-aware buy-primary formatting (WP-purchasing-editor,
 * DESIGN_PURCHASING.md §6: "1 jar" instead of "250 g"). The two things this
 * MUST get right: rendering the label when it's set on a whole-mode
 * ingredient, and falling back cleanly to the plain amount for every case
 * where it isn't (unset, loose mode, or an amount that isn't a clean
 * multiple of the pack).
 */
import { describe, expect, it } from "vitest";
import { makeIngredientId, makeQuantity, suggestPurchase, type Ingredient } from "../../domain/index.ts";
import { formatBuyPrimary } from "./purchase-display.ts";

const MAYO: Ingredient = {
  id: makeIngredientId("mayonnaise"),
  name: "Mayonnaise",
  unit: "g",
  shelfLifeDays: 90,
  openedShelfLifeDays: 30,
  defaultLocation: "fridge",
  purchaseMode: "whole",
  packSize: { amount: 250, unit: "g" },
  packLabel: "jar",
};

const FLOUR: Ingredient = {
  id: makeIngredientId("flour"),
  name: "Flour",
  unit: "g",
  shelfLifeDays: 365,
  openedShelfLifeDays: 365,
  defaultLocation: "pantry",
  // loose mode (the default for "g") — never a candidate for a pack label,
  // even if one were set (there is no pack to count).
};

describe("formatBuyPrimary", () => {
  it("renders '1 jar' for a whole-mode ingredient with a packLabel, need rounds up to exactly one pack", () => {
    const need = makeQuantity(130, "g");
    const suggestion = suggestPurchase(need, MAYO);
    expect(suggestion.quantity.amount).toBe(250); // one 250 g jar
    expect(formatBuyPrimary(suggestion.quantity, MAYO, suggestion)).toBe("1 jar");
  });

  it("pluralises when the buy amount is more than one pack", () => {
    const need = makeQuantity(300, "g"); // needs two jars (§5 scenario 7)
    const suggestion = suggestPurchase(need, MAYO);
    expect(suggestion.quantity.amount).toBe(500);
    expect(formatBuyPrimary(suggestion.quantity, MAYO, suggestion)).toBe("2 jars");
  });

  it("falls back to the plain formatted amount when packLabel is unset", () => {
    const { packLabel, ...rest } = MAYO;
    expect(packLabel).toBe("jar"); // sanity: MAYO really had one before this test strips it
    const noLabel: Ingredient = rest;
    const need = makeQuantity(130, "g");
    const suggestion = suggestPurchase(need, noLabel);
    expect(formatBuyPrimary(suggestion.quantity, noLabel, suggestion)).toBe("250 g");
  });

  it("falls back to the plain formatted amount for a loose-mode ingredient even if packLabel were somehow set", () => {
    const looseWithLabel: Ingredient = { ...FLOUR, packLabel: "bag" };
    const need = makeQuantity(130, "g");
    const suggestion = suggestPurchase(need, looseWithLabel);
    expect(suggestion.mode).toBe("loose");
    expect(formatBuyPrimary(suggestion.quantity, looseWithLabel, suggestion)).toBe("130 g");
  });

  it("falls back to the plain formatted amount when the quantity isn't a clean multiple of the pack (a household override)", () => {
    // The household typed an arbitrary override amount that doesn't line up
    // with the 250 g jar — "1 jar" would be a lie, so this must degrade to
    // the honest gram amount rather than rounding silently.
    const suggestion = suggestPurchase(makeQuantity(130, "g"), MAYO);
    const oddAmount = makeQuantity(300, "g");
    expect(formatBuyPrimary(oddAmount, MAYO, suggestion)).toBe("300 g");
  });
});
