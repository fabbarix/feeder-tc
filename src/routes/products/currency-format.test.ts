import { describe, expect, it } from "vitest";
import { basisLabel, formatMoney } from "./currency-format.ts";

describe("formatMoney", () => {
  it("prefixes the given symbol and always shows two decimal places", () => {
    expect(formatMoney(2.4, "$")).toBe("$2.40");
    expect(formatMoney(0.5, "€")).toBe("€0.50");
    expect(formatMoney(10, "£")).toBe("£10.00");
  });

  it("never hardcodes a symbol — the caller's Settings.currency always wins", () => {
    expect(formatMoney(1, "¥")).toBe("¥1.00");
  });
});

describe("basisLabel", () => {
  it("labels every NormalizedPriceBasis", () => {
    expect(basisLabel("per-100g")).toBe("per 100 g");
    expect(basisLabel("per-100ml")).toBe("per 100 ml");
    expect(basisLabel("per-piece")).toBe("per piece");
  });
});
