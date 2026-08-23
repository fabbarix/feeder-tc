/**
 * I/O half of the WP-PRODUCTS-MODEL legacy migration. The pure computation
 * (`migrateLegacyProductBarcodes`, src/domain/products.ts) decides which
 * `ProductBarcode` rows a workbook is missing; this module reads the two
 * sheets it needs and writes exactly those rows via `WorkbookStore
 * .productBarcodes.upsert`.
 *
 * Run alongside `ensureWorkbookSchema` (migrate.ts) whenever a workbook is
 * opened, not only when it is created — a pre-re-key workbook has `Products`
 * rows keyed by barcode but no `ProductBarcodes` rows at all until this has
 * run once. Safe to call on every open: the common case (already migrated,
 * or a brand-new workbook with no products yet) computes zero rows to write
 * and makes no mutating request beyond the two reads.
 */
import type { WorkbookStore } from "../domain/contracts.ts";
import { migrateLegacyProductBarcodes } from "../domain/products.ts";

export interface RunProductBarcodeMigrationResult {
  /** How many `ProductBarcode` rows were written. Zero on an already-migrated (or empty) workbook — the expected steady state. */
  readonly written: number;
  /** Legacy products whose id didn't parse as a barcode, so no row could be inferred for them — see `migrateLegacyProductBarcodes`'s own doc comment. Empty in the expected case. */
  readonly unresolvable: number;
}

export async function runProductBarcodeMigration(store: WorkbookStore): Promise<RunProductBarcodeMigrationResult> {
  const [products, barcodes] = await Promise.all([store.products.readAll(), store.productBarcodes.readAll()]);
  const { rowsToWrite, unresolvable } = migrateLegacyProductBarcodes(products.rows, barcodes.rows);

  for (const row of rowsToWrite) {
    await store.productBarcodes.upsert(row);
  }

  return { written: rowsToWrite.length, unresolvable: unresolvable.length };
}
