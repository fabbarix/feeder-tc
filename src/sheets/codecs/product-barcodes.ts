/**
 * `ProductBarcodes` sheet codec (WP-PRODUCTS-MODEL) — one row per barcode a
 * `Product` is sold under (invariant 6: never a delimited list in a
 * `Products` cell). Columns: `product_id, barcode`.
 *
 * This sheet is new; there is no legacy row shape to preserve here. The
 * legacy-compatibility work is entirely on the *migration* side —
 * `src/domain/products.ts`'s `migrateLegacyProductBarcodes` computes the
 * rows a pre-re-key workbook is missing (one per existing `Products` row)
 * and a caller appends them via `WorkbookStore.productBarcodes.upsert`.
 */
import type { CellRow } from "../../domain/contracts.ts";
import { makeBarcode, makeProductId, type ProductBarcode } from "../../domain/types.ts";
import { cellString } from "./common.ts";

export const PRODUCT_BARCODES_HEADER: CellRow = ["product_id", "barcode"];

export function encodeProductBarcode(row: ProductBarcode): CellRow {
  return [row.productId, row.barcode];
}

export function decodeProductBarcode(row: CellRow): ProductBarcode {
  const productId = makeProductId(cellString(row, 0, "product_id"));
  const barcode = makeBarcode(cellString(row, 1, "barcode"));
  return { productId, barcode };
}
