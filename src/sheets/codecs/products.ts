/**
 * `Products` sheet codec (M6-A) — DESIGN_PRODUCTS.md §2:
 * `barcode, name, brand, ingredient_id, canonical_quantity, canonical_unit,
 * display_quantity, display_unit, shelf_life_days, is_bulk, has_photo`.
 *
 * `canonical_quantity`/`canonical_unit` are the only columns any engine or
 * fold may ever read for arithmetic (invariant 3). `display_quantity`/
 * `display_unit` are exactly what the human typed at entry time ("1 lb
 * bag") — display/provenance only, never validated against the ingredient's
 * canonical unit, and never converted here. See src/domain/units.ts for the
 * one place that conversion happens, before a `Product` ever reaches this
 * codec.
 */
import type { CellRow } from "../../domain/contracts.ts";
import { makeBarcode, makeIngredientId, makeQuantity, type Product } from "../../domain/types.ts";
import { cellBoolean, cellEnum, cellNumber, cellOptionalString, cellString } from "./common.ts";
import { ENTRY_UNITS, UNITS } from "./enums.ts";

export const PRODUCTS_HEADER: CellRow = [
  "barcode",
  "name",
  "brand",
  "ingredient_id",
  "canonical_quantity",
  "canonical_unit",
  "display_quantity",
  "display_unit",
  "shelf_life_days",
  "is_bulk",
  "has_photo",
];

export function encodeProduct(product: Product): CellRow {
  return [
    product.barcode,
    product.name,
    product.brand ?? "",
    product.ingredientId,
    product.canonicalQuantity.amount,
    product.canonicalQuantity.unit,
    product.displayQuantity,
    product.displayUnit,
    product.shelfLifeDays,
    product.isBulk,
    product.hasPhoto,
  ];
}

export function decodeProduct(row: CellRow): Product {
  const barcode = makeBarcode(cellString(row, 0, "barcode"));
  const name = cellString(row, 1, "name");
  const brand = cellOptionalString(row, 2);
  const ingredientId = makeIngredientId(cellString(row, 3, "ingredient_id"));
  const canonicalAmount = cellNumber(row, 4, "canonical_quantity");
  const canonicalUnit = cellEnum(row, 5, "canonical_unit", UNITS);
  const displayQuantity = cellNumber(row, 6, "display_quantity");
  const displayUnit = cellEnum(row, 7, "display_unit", ENTRY_UNITS);
  const shelfLifeDays = cellNumber(row, 8, "shelf_life_days");
  const isBulk = cellBoolean(row, 9, "is_bulk");
  const hasPhoto = cellBoolean(row, 10, "has_photo");

  if (canonicalAmount <= 0) {
    throw new Error(`canonical_quantity must be greater than 0, got ${canonicalAmount}`);
  }
  if (displayQuantity <= 0) {
    throw new Error(`display_quantity must be greater than 0, got ${displayQuantity}`);
  }
  if (shelfLifeDays < 0) {
    throw new Error(`shelf_life_days must not be negative, got ${shelfLifeDays}`);
  }

  return {
    barcode,
    name,
    ...(brand !== undefined ? { brand } : {}),
    ingredientId,
    canonicalQuantity: makeQuantity(canonicalAmount, canonicalUnit),
    displayQuantity,
    displayUnit,
    shelfLifeDays,
    isBulk,
    hasPhoto,
  };
}
