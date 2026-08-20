/** `ShoppingItems` sheet codec (WP-11) — DESIGN.md §3: current list state. */
import type { CellRow } from "../../domain/contracts.ts";
import { makeIngredientId, makeIsoDate, makeQuantity, type ShoppingItem } from "../../domain/types.ts";
import { cellBoolean, cellNumber, cellOptionalNumber, cellOptionalString, cellString } from "./common.ts";
import { isUnit, UNITS } from "./enums.ts";

export const SHOPPING_ITEMS_HEADER: CellRow = [
  "ingredient_id",
  "range_start",
  "range_end",
  "needed_amount",
  "needed_unit",
  "checked",
  "bought_amount",
  "bought_unit",
];

export function encodeShoppingItem(item: ShoppingItem): CellRow {
  return [
    item.ingredientId,
    item.rangeStart,
    item.rangeEnd,
    item.neededQuantity.amount,
    item.neededQuantity.unit,
    item.checked,
    item.boughtQuantity?.amount ?? "",
    item.boughtQuantity?.unit ?? "",
  ];
}

export function decodeShoppingItem(row: CellRow): ShoppingItem {
  const ingredientId = makeIngredientId(cellString(row, 0, "ingredient_id"));
  const rangeStart = makeIsoDate(cellString(row, 1, "range_start"));
  const rangeEnd = makeIsoDate(cellString(row, 2, "range_end"));
  const neededAmount = cellNumber(row, 3, "needed_amount");
  const neededUnitRaw = cellString(row, 4, "needed_unit");
  if (!isUnit(neededUnitRaw)) {
    throw new Error(`needed_unit must be one of ${UNITS.join(", ")}, got ${JSON.stringify(neededUnitRaw)}`);
  }
  if (neededAmount <= 0) {
    throw new Error(`needed_amount must be greater than 0, got ${neededAmount}`);
  }
  const checked = cellBoolean(row, 5, "checked");
  const boughtAmount = cellOptionalNumber(row, 6, "bought_amount");
  const boughtUnitRaw = cellOptionalString(row, 7);

  let boughtQuantity: ShoppingItem["boughtQuantity"];
  if (boughtAmount !== undefined || boughtUnitRaw !== undefined) {
    if (boughtAmount === undefined || boughtUnitRaw === undefined) {
      throw new Error("bought_amount and bought_unit must both be present or both blank");
    }
    if (!isUnit(boughtUnitRaw)) {
      throw new Error(`bought_unit must be one of ${UNITS.join(", ")}, got ${JSON.stringify(boughtUnitRaw)}`);
    }
    if (boughtAmount <= 0) {
      throw new Error(`bought_amount must be greater than 0, got ${boughtAmount}`);
    }
    boughtQuantity = makeQuantity(boughtAmount, boughtUnitRaw);
  }

  return {
    ingredientId,
    rangeStart,
    rangeEnd,
    neededQuantity: makeQuantity(neededAmount, neededUnitRaw),
    checked,
    ...(boughtQuantity !== undefined ? { boughtQuantity } : {}),
  };
}
