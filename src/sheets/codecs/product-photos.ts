/**
 * `ProductPhotos` sheet codec (M6-A) — DESIGN_PRODUCTS.md §2/§5:
 * `barcode, data_url`, deliberately its own sheet (see `ProductPhoto`'s doc
 * comment in src/domain/types.ts and `WorkbookStore.productPhotos` in
 * src/domain/contracts.ts — no `readAll` on this namespace, ever).
 *
 * A Google Sheets cell holds at most 50,000 characters
 * (`MAX_PRODUCT_PHOTO_DATA_URL_LENGTH`, defined in domain/types.ts since
 * both this codec and the in-memory fake in
 * src/domain/fakes/workbook-store.ts must enforce the same ceiling — see
 * that constant's doc comment). The (out-of-scope-for-M6-A, future UI)
 * photo encoder targets a 32 KB *byte* budget with real headroom under
 * that ceiling (see DESIGN_PRODUCTS.md §5's byte-budget table) — but this
 * codec is the backstop that actually enforces the hard limit: encoding a
 * `ProductPhoto` whose `dataUrl` would not fit in one cell throws rather
 * than silently truncating. A breach is data loss, not a warning
 * (DESIGN_PRODUCTS.md §5), so this is a thrown `Error` on the write path,
 * not a `DataWarning` — the same way `WorkbookStore.recipeIngredients
 * .replaceForRecipe` throws on a unit mismatch instead of quarantining it,
 * because this is the app's own encoder failing its contract, not a human
 * hand-editing the sheet.
 */
import type { CellRow } from "../../domain/contracts.ts";
import { MAX_PRODUCT_PHOTO_DATA_URL_LENGTH, makeBarcode, type ProductPhoto } from "../../domain/types.ts";
import { cellString } from "./common.ts";

export const PRODUCT_PHOTOS_HEADER: CellRow = ["barcode", "data_url"];

/** Re-exported for convenience so callers of this codec don't need a second import from domain/types.ts — same value as `MAX_PRODUCT_PHOTO_DATA_URL_LENGTH`, the source of truth. */
export const MAX_PHOTO_DATA_URL_LENGTH = MAX_PRODUCT_PHOTO_DATA_URL_LENGTH;

export function encodeProductPhoto(photo: ProductPhoto): CellRow {
  if (photo.dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
    throw new Error(
      `Product photo data URL is ${photo.dataUrl.length} characters, over the ${MAX_PHOTO_DATA_URL_LENGTH}-character Google Sheets cell limit (DESIGN_PRODUCTS.md §5). Refusing to write — re-encode at a smaller byte budget rather than truncating.`,
    );
  }
  return [photo.barcode, photo.dataUrl];
}

export function decodeProductPhoto(row: CellRow): ProductPhoto {
  const barcode = makeBarcode(cellString(row, 0, "barcode"));
  const dataUrl = cellString(row, 1, "data_url");
  if (dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
    // A cell physically cannot hold this many characters, so a row read back
    // this long could only come from something other than this app (or a
    // future raised limit) — quarantine like any other malformed row rather
    // than trusting it.
    throw new Error(
      `data_url is ${dataUrl.length} characters, over the ${MAX_PHOTO_DATA_URL_LENGTH}-character Google Sheets cell limit`,
    );
  }
  return { barcode, dataUrl };
}
