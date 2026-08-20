/**
 * `InventoryEvents` sheet codec (WP-11) — append-only event log (invariant
 * 1: rows are immutable; corrections are new `adjust` events).
 *
 * Per the coordinator's decision recorded in HANDOVER.md/README.md: this
 * sheet has NO generic `meta` column. DESIGN.md §3's trailing `meta` in the
 * summary table is shorthand superseded by WP-02's review — a catch-all
 * cell would be a JSON blob and break invariant 6. Instead every variant's
 * concrete fields get their own column, blank where not applicable — a
 * union-of-all-variant-fields row shape:
 *
 *   type | id | timestamp | ingredient_id | lot_id | quantity_amount |
 *   quantity_unit | location | purchase_date | expiry_override |
 *   delta_amount | delta_unit | expiry | reason
 *
 * Column usage per event type (blank elsewhere):
 *  - purchase: lot_id, quantity_amount/unit, location, purchase_date, [expiry_override]
 *  - use:      quantity_amount/unit only (no lot_id — FIFO-consumed at fold time, see types.ts)
 *  - spoil:    lot_id, quantity_amount/unit
 *  - adjust:   lot_id, [delta_amount/unit], [expiry], [reason] — at least one of delta/expiry required
 *  - move:     lot_id, location
 *  - open:     lot_id only
 */
import type { CellRow } from "../../domain/contracts.ts";
import {
  makeAdjustEvent,
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makeQuantity,
  type InventoryEvent,
  type Quantity,
  type Unit,
} from "../../domain/types.ts";
import { cellEnum, cellNumber, cellOptionalNumber, cellOptionalString, cellString } from "./common.ts";
import { EVENT_TYPES, isUnit, STORAGE_LOCATIONS, UNITS } from "./enums.ts";

export const INVENTORY_EVENTS_HEADER: CellRow = [
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
];

export function encodeInventoryEvent(event: InventoryEvent): CellRow {
  const base: CellRow = [event.type, event.id, event.timestamp, event.ingredientId];
  switch (event.type) {
    case "purchase":
      return [
        ...base,
        event.lotId,
        event.quantity.amount,
        event.quantity.unit,
        event.location,
        event.purchaseDate,
        event.expiryOverride ?? "",
        "",
        "",
        "",
        "",
      ];
    case "use":
      return [...base, "", event.quantity.amount, event.quantity.unit, "", "", "", "", "", "", ""];
    case "spoil":
      return [...base, event.lotId, event.quantity.amount, event.quantity.unit, "", "", "", "", "", "", ""];
    case "adjust":
      return [
        ...base,
        event.lotId,
        "",
        "",
        "",
        "",
        "",
        event.delta?.amount ?? "",
        event.delta?.unit ?? "",
        event.expiry ?? "",
        event.reason ?? "",
      ];
    case "move":
      return [...base, event.lotId, "", "", event.location, "", "", "", "", "", ""];
    case "open":
      return [...base, event.lotId, "", "", "", "", "", "", "", "", ""];
  }
}

function requireUnit(raw: string, field: string): Unit {
  if (!isUnit(raw)) {
    throw new Error(`${field} must be one of ${UNITS.join(", ")}, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function requirePositiveQuantity(row: CellRow): { amount: number; unit: Unit } {
  const amount = cellNumber(row, 5, "quantity_amount");
  const unit = requireUnit(cellString(row, 6, "quantity_unit"), "quantity_unit");
  if (amount <= 0) {
    throw new Error(`quantity_amount must be greater than 0, got ${amount}`);
  }
  return { amount, unit };
}

export function decodeInventoryEvent(row: CellRow): InventoryEvent {
  const type = cellEnum(row, 0, "type", EVENT_TYPES);
  const id = makeEventId(cellString(row, 1, "id"));
  const timestamp = makeIsoTimestamp(cellString(row, 2, "timestamp"));
  const ingredientId = makeIngredientId(cellString(row, 3, "ingredient_id"));

  switch (type) {
    case "purchase": {
      const lotId = makeLotId(cellString(row, 4, "lot_id"));
      const { amount, unit } = requirePositiveQuantity(row);
      const location = cellEnum(row, 7, "location", STORAGE_LOCATIONS);
      const purchaseDate = makeIsoDate(cellString(row, 8, "purchase_date"));
      const expiryOverrideRaw = cellOptionalString(row, 9);
      return {
        type: "purchase",
        id,
        timestamp,
        ingredientId,
        lotId,
        quantity: makeQuantity(amount, unit),
        location,
        purchaseDate,
        ...(expiryOverrideRaw !== undefined ? { expiryOverride: makeIsoDate(expiryOverrideRaw) } : {}),
      };
    }
    case "use": {
      const { amount, unit } = requirePositiveQuantity(row);
      return { type: "use", id, timestamp, ingredientId, quantity: makeQuantity(amount, unit) };
    }
    case "spoil": {
      const lotId = makeLotId(cellString(row, 4, "lot_id"));
      const { amount, unit } = requirePositiveQuantity(row);
      return { type: "spoil", id, timestamp, ingredientId, lotId, quantity: makeQuantity(amount, unit) };
    }
    case "adjust": {
      const lotId = makeLotId(cellString(row, 4, "lot_id"));
      const deltaAmount = cellOptionalNumber(row, 10, "delta_amount");
      const deltaUnitRaw = cellOptionalString(row, 11);
      const expiryRaw = cellOptionalString(row, 12);
      const reasonRaw = cellOptionalString(row, 13);
      let delta: Quantity | undefined;
      if (deltaAmount !== undefined || deltaUnitRaw !== undefined) {
        if (deltaAmount === undefined || deltaUnitRaw === undefined) {
          throw new Error("delta_amount and delta_unit must both be present or both blank");
        }
        delta = makeQuantity(deltaAmount, requireUnit(deltaUnitRaw, "delta_unit"));
      }
      // makeAdjustEvent itself throws if neither delta nor expiry ends up
      // present — that throw is caught by decodeRows just like every other
      // field check above, turning "neither present" into a DataWarning too
      // (the WP-11 brief's explicit requirement), not a crash.
      return makeAdjustEvent({
        id,
        timestamp,
        ingredientId,
        lotId,
        ...(delta !== undefined ? { delta } : {}),
        ...(expiryRaw !== undefined ? { expiry: makeIsoDate(expiryRaw) } : {}),
        ...(reasonRaw !== undefined ? { reason: reasonRaw } : {}),
      });
    }
    case "move": {
      const lotId = makeLotId(cellString(row, 4, "lot_id"));
      const location = cellEnum(row, 7, "location", STORAGE_LOCATIONS);
      return { type: "move", id, timestamp, ingredientId, lotId, location };
    }
    case "open": {
      const lotId = makeLotId(cellString(row, 4, "lot_id"));
      return { type: "open", id, timestamp, ingredientId, lotId };
    }
  }
}
