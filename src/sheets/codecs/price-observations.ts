/**
 * `PriceObservations` sheet codec (M6-A) — DESIGN_PRODUCTS.md §2: append-only
 * time series, `timestamp, barcode?, ingredient_id, quantity, unit, price,
 * source`. Columns here are `id, timestamp, barcode, ingredient_id,
 * quantity_amount, quantity_unit, price, source` — an `id` column is added
 * ahead of `timestamp`, matching `InventoryEvents`' client-generated-id
 * pattern (types.ts's `PriceObservationId`), and `quantity`/`unit` are split
 * into two columns the same way every other quantity-bearing sheet in this
 * directory does it (never one packed cell — invariant 6).
 *
 * No currency column (DESIGN_PRODUCTS.md §4): the household has a single
 * currency held in `Settings.currency`, applied at display time.
 */
import type { CellRow } from "../../domain/contracts.ts";
import {
  makeBarcode,
  makeIngredientId,
  makeIsoTimestamp,
  makePriceObservationId,
  makeQuantity,
  type PriceObservation,
} from "../../domain/types.ts";
import { cellEnum, cellNumber, cellOptionalString, cellString } from "./common.ts";
import { UNITS } from "./enums.ts";

export const PRICE_OBSERVATIONS_HEADER: CellRow = [
  "id",
  "timestamp",
  "barcode",
  "ingredient_id",
  "quantity_amount",
  "quantity_unit",
  "price",
  "source",
];

export function encodePriceObservation(observation: PriceObservation): CellRow {
  return [
    observation.id,
    observation.timestamp,
    observation.barcode ?? "",
    observation.ingredientId,
    observation.quantity.amount,
    observation.quantity.unit,
    observation.price,
    observation.source ?? "",
  ];
}

export function decodePriceObservation(row: CellRow): PriceObservation {
  const id = makePriceObservationId(cellString(row, 0, "id"));
  const timestamp = makeIsoTimestamp(cellString(row, 1, "timestamp"));
  const barcodeRaw = cellOptionalString(row, 2);
  const ingredientId = makeIngredientId(cellString(row, 3, "ingredient_id"));
  const amount = cellNumber(row, 4, "quantity_amount");
  const unit = cellEnum(row, 5, "quantity_unit", UNITS);
  const price = cellNumber(row, 6, "price");
  const source = cellOptionalString(row, 7);

  if (amount <= 0) {
    throw new Error(`quantity_amount must be greater than 0, got ${amount}`);
  }
  if (price < 0) {
    throw new Error(`price must not be negative, got ${price}`);
  }

  return {
    id,
    timestamp,
    ...(barcodeRaw !== undefined ? { barcode: makeBarcode(barcodeRaw) } : {}),
    ingredientId,
    quantity: makeQuantity(amount, unit),
    price,
    ...(source !== undefined ? { source } : {}),
  };
}
