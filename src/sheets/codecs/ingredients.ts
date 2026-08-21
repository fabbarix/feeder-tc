/** `Ingredients` sheet codec (WP-11) — DESIGN.md §3 / §2 "Ingredients". */
import type { CellRow } from "../../domain/contracts.ts";
import { makeIngredientId, makeQuantity, type Ingredient } from "../../domain/types.ts";
import {
  cellEnum,
  cellNumber,
  cellOptionalBoolean,
  cellOptionalNumber,
  cellOptionalString,
  cellString,
} from "./common.ts";
import { isIngredientCategory, isPurchaseMode, isUnit, STORAGE_LOCATIONS, UNITS } from "./enums.ts";

export const INGREDIENTS_HEADER: CellRow = [
  "id",
  "name",
  "unit",
  "shelf_life_days",
  "opened_shelf_life_days",
  "default_location",
  // WP-VC3, appended at the end (additive — see types.ts's Ingredient.category
  // doc comment): a workbook created before this change has rows with no
  // cell here at all, not just a blank one. decodeIngredient below must
  // treat that the same as an explicitly blank cell — undefined, never a
  // thrown error/quarantined row.
  "category",
  // WP-PHOTO, appended after category for the same reason — see
  // types.ts's Ingredient.hasPhoto doc comment.
  "has_photo",
  // WP-PURCHASING, appended after has_photo (additive, same "missing cell
  // decodes to undefined" rule — see types.ts's Ingredient.purchaseMode/
  // packSize/roundTo/gramsPerMl/gramsPerPiece doc comments).
  "purchase_mode",
  "pack_size_amount",
  "pack_size_unit",
  "round_to",
  "grams_per_ml",
  "grams_per_piece",
];

export function encodeIngredient(ingredient: Ingredient): CellRow {
  return [
    ingredient.id,
    ingredient.name,
    ingredient.unit,
    ingredient.shelfLifeDays,
    ingredient.openedShelfLifeDays,
    ingredient.defaultLocation,
    ingredient.category ?? "",
    ingredient.hasPhoto ?? "",
    ingredient.purchaseMode ?? "",
    ingredient.packSize?.amount ?? "",
    ingredient.packSize?.unit ?? "",
    ingredient.roundTo ?? "",
    ingredient.gramsPerMl ?? "",
    ingredient.gramsPerPiece ?? "",
  ];
}

/**
 * `unit` is validated against the canonical `Unit` union — the BDD example
 * ("a row with unit 'banana-units'") is this exact check. Invariant 3's
 * "reject mixed-unit writes at the codec layer" is enforced here at the
 * source: every other sheet that references an ingredient (RecipeIngredients)
 * cross-checks against whatever unit this row decodes to.
 *
 * `category` (index 6) is deliberately the most lenient cell on this row:
 * missing (legacy row, `row[6] === undefined`), blank (`""`), AND an
 * unrecognised string (a hand-typed typo) all decode to `undefined` rather
 * than throwing — this column is shopping-list grouping metadata, not a
 * structural fact the way `unit`/`default_location` are, so a bad value
 * here must never quarantine the whole ingredient row (a real user's
 * pre-WP-VC3 workbook has to keep loading).
 */
export function decodeIngredient(row: CellRow): Ingredient {
  const id = makeIngredientId(cellString(row, 0, "id"));
  const name = cellString(row, 1, "name");
  const unit = cellEnum(row, 2, "unit", UNITS);
  const shelfLifeDays = cellNumber(row, 3, "shelf_life_days");
  const openedShelfLifeDays = cellNumber(row, 4, "opened_shelf_life_days");
  const defaultLocation = cellEnum(row, 5, "default_location", STORAGE_LOCATIONS);
  if (shelfLifeDays < 0) {
    throw new Error(`shelf_life_days must not be negative, got ${shelfLifeDays}`);
  }
  if (openedShelfLifeDays < 0) {
    throw new Error(`opened_shelf_life_days must not be negative, got ${openedShelfLifeDays}`);
  }
  const categoryRaw = cellOptionalString(row, 6);
  const category = categoryRaw !== undefined && isIngredientCategory(categoryRaw) ? categoryRaw : undefined;
  const hasPhoto = cellOptionalBoolean(row, 7, "has_photo");

  // WP-PURCHASING columns (8-13) — every one leniently missing-safe, same
  // "no cell at all decodes to undefined" rule as category/has_photo above:
  // a pre-existing workbook's rows simply have nothing here.
  const purchaseModeRaw = cellOptionalString(row, 8);
  const purchaseMode = purchaseModeRaw !== undefined && isPurchaseMode(purchaseModeRaw) ? purchaseModeRaw : undefined;
  const packSizeAmount = cellOptionalNumber(row, 9, "pack_size_amount");
  const packSizeUnitRaw = cellOptionalString(row, 10);
  // packSize must be in THIS ingredient's own canonical unit (invariant 3's
  // spirit extends here too) — a mismatch is dropped, not trusted blindly,
  // the same "never quarantine over a soft/derived field" treatment
  // `category` gets above.
  let packSize: Ingredient["packSize"];
  if (
    packSizeAmount !== undefined &&
    packSizeUnitRaw !== undefined &&
    isUnit(packSizeUnitRaw) &&
    packSizeUnitRaw === unit &&
    packSizeAmount > 0
  ) {
    packSize = makeQuantity(packSizeAmount, packSizeUnitRaw);
  }
  const roundToRaw = cellOptionalNumber(row, 11, "round_to");
  const roundTo = roundToRaw !== undefined && roundToRaw > 0 ? roundToRaw : undefined;
  const gramsPerMlRaw = cellOptionalNumber(row, 12, "grams_per_ml");
  const gramsPerMl = gramsPerMlRaw !== undefined && gramsPerMlRaw > 0 ? gramsPerMlRaw : undefined;
  const gramsPerPieceRaw = cellOptionalNumber(row, 13, "grams_per_piece");
  const gramsPerPiece = gramsPerPieceRaw !== undefined && gramsPerPieceRaw > 0 ? gramsPerPieceRaw : undefined;

  return {
    id,
    name,
    unit,
    shelfLifeDays,
    openedShelfLifeDays,
    defaultLocation,
    ...(category !== undefined ? { category } : {}),
    ...(hasPhoto !== undefined ? { hasPhoto } : {}),
    ...(purchaseMode !== undefined ? { purchaseMode } : {}),
    ...(packSize !== undefined ? { packSize } : {}),
    ...(roundTo !== undefined ? { roundTo } : {}),
    ...(gramsPerMl !== undefined ? { gramsPerMl } : {}),
    ...(gramsPerPiece !== undefined ? { gramsPerPiece } : {}),
  };
}
