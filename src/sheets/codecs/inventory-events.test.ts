/**
 * Explicit examples for the two malformed-row behaviours called out by name
 * in IMPLEMENTATION_PLAN.md WP-11 and the coordinator's decision register:
 *
 *  - "A malformed row (e.g. non-numeric quantity) is skipped and reported,
 *    not thrown."
 *  - "AdjustEvent has optional delta and optional expiry; at least one must
 *    be present... your codec must reject a decoded row with neither as a
 *    DataWarning, not a throw."
 *
 * The property test in roundtrip.property.test.ts proves the happy path
 * (encode -> decode is identity) across the whole InventoryEvent domain;
 * this file proves the unhappy path stays a `DataWarning`, never an
 * exception, via the shared `decodeRows` driver every sheet goes through.
 */
import { describe, expect, it } from "vitest";
import { decodeRows } from "./common.ts";
import { decodeInventoryEvent, INVENTORY_EVENTS_HEADER } from "./inventory-events.ts";

describe("InventoryEvents malformed-row handling", () => {
  it("a non-numeric quantity is skipped and reported, not thrown", () => {
    const rows = [
      // header-shaped for readability; decodeRows only cares about the data rows below
      ["use", "evt-1", "2026-03-01T09:00:00Z", "rice", "", "not-a-number", "g", "", "", "", "", "", "", ""],
    ];

    expect(() => decodeRows("InventoryEvents", rows, 2, decodeInventoryEvent)).not.toThrow();

    const { rows: decoded, warnings } = decodeRows("InventoryEvents", rows, 2, decodeInventoryEvent);
    expect(decoded).toEqual([]);
    expect(warnings).toEqual([
      { sheet: "InventoryEvents", row: 2, reason: expect.stringContaining("quantity_amount") },
    ]);
  });

  it("an adjust row with neither delta nor expiry is skipped and reported, not thrown", () => {
    const rows = [
      // type,id,timestamp,ingredient_id,lot_id,qty_amt,qty_unit,location,purchase_date,expiry_override,delta_amount,delta_unit,expiry,reason
      ["adjust", "evt-2", "2026-03-01T09:00:00Z", "rice", "lot-1", "", "", "", "", "", "", "", "", ""],
    ];

    expect(() => decodeRows("InventoryEvents", rows, 2, decodeInventoryEvent)).not.toThrow();

    const { rows: decoded, warnings } = decodeRows("InventoryEvents", rows, 2, decodeInventoryEvent);
    expect(decoded).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ sheet: "InventoryEvents", row: 2 });
    expect(warnings[0]?.reason).toMatch(/delta|expiry/i);
  });

  it("a well-formed row alongside a malformed one: the good row still loads", () => {
    const goodRow = ["open", "evt-3", "2026-03-01T09:00:00Z", "rice", "lot-1", "", "", "", "", "", "", "", "", ""];
    const badRow = ["use", "evt-4", "2026-03-02T09:00:00Z", "rice", "", "-5", "g", "", "", "", "", "", "", ""];
    const rows = [goodRow, badRow];

    const { rows: decoded, warnings } = decodeRows("InventoryEvents", rows, 2, decodeInventoryEvent);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toMatchObject({ type: "open", ingredientId: "rice" });
    expect(warnings).toEqual([
      { sheet: "InventoryEvents", row: 3, reason: expect.stringContaining("quantity_amount") },
    ]);
  });

  it("HEADER has the union-of-all-variant-fields shape used above", () => {
    expect(INVENTORY_EVENTS_HEADER).toEqual([
      "type",
      "id",
      "timestamp",
      "ingredient_id",
      "lot_id",
      "quantity_amount",
      "quantity_unit",
      "location",
      "purchase_date",
      "expiry_override",
      "delta_amount",
      "delta_unit",
      "expiry",
      "reason",
    ]);
  });
});
