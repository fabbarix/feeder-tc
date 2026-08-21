/**
 * `Photos` sheet codec (WP-PHOTO) — DESIGN_PHOTOS.md §2:
 * `owner_kind, owner_id, data_url, updated_at`. One sheet for every
 * photo-owning entity (recipe / recipe-step / ingredient / product),
 * superseding M6-A's per-entity `ProductPhotos` sheet (see
 * `src/domain/types.ts`'s `Photo` doc comment, and DESIGN_PHOTOS.md §7 for
 * why folding that sheet in here was safe: it never held data).
 *
 * A Google Sheets cell holds at most 50,000 characters
 * (`MAX_PHOTO_DATA_URL_LENGTH`, defined in domain/types.ts since both this
 * codec and the in-memory fake in src/domain/fakes/workbook-store.ts must
 * enforce the same ceiling — see that constant's doc comment). The photo
 * encoder (src/photos/encode.ts) targets a 32 KB *byte* budget with real
 * headroom under that ceiling (DESIGN_PHOTOS.md §4's byte-budget table) —
 * but this codec is the backstop that actually enforces the hard limit:
 * encoding a `Photo` whose `dataUrl` would not fit in one cell throws
 * rather than silently truncating. A breach is data loss, not a warning
 * (DESIGN_PHOTOS.md §4), so this is a thrown `Error` on the write path, not
 * a `DataWarning` — the same way `WorkbookStore.recipeIngredients
 * .replaceForRecipe` throws on a unit mismatch instead of quarantining it,
 * because this is the app's own encoder failing its contract, not a human
 * hand-editing the sheet.
 */
import type { CellRow } from "../../domain/contracts.ts";
import {
  MAX_PHOTO_DATA_URL_LENGTH,
  makeBarcode,
  makeIngredientId,
  makeIsoTimestamp,
  makeRecipeId,
  makeStepId,
  type Photo,
  type PhotoOwnerId,
  type PhotoOwnerKind,
} from "../../domain/types.ts";
import { cellString } from "./common.ts";
import { PHOTO_OWNER_KINDS } from "./enums.ts";

// Re-exported for convenience so callers of this codec (and the barrel,
// ./index.ts) don't need a second import from domain/types.ts — same value
// as the one defined there, which is the source of truth.
export { MAX_PHOTO_DATA_URL_LENGTH } from "../../domain/types.ts";

export const PHOTOS_HEADER: CellRow = ["owner_kind", "owner_id", "data_url", "updated_at"];

/** Reconstructs the correctly-branded owner id for `ownerKind` — the one place that has to know all four owner id brands at once. */
function decodeOwnerId(ownerKind: PhotoOwnerKind, raw: string): PhotoOwnerId {
  switch (ownerKind) {
    case "recipe":
      return makeRecipeId(raw);
    case "recipe-step":
      return makeStepId(raw);
    case "ingredient":
      return makeIngredientId(raw);
    case "product":
      return makeBarcode(raw);
  }
}

export function encodePhoto(photo: Photo): CellRow {
  if (photo.dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
    throw new Error(
      `Photo data URL is ${photo.dataUrl.length} characters, over the ${MAX_PHOTO_DATA_URL_LENGTH}-character Google Sheets cell limit (DESIGN_PHOTOS.md §4). Refusing to write — re-encode at a smaller byte budget rather than truncating.`,
    );
  }
  return [photo.ownerKind, photo.ownerId, photo.dataUrl, photo.updatedAt];
}

export function decodePhoto(row: CellRow): Photo {
  const ownerKindRaw = cellString(row, 0, "owner_kind");
  if (!(PHOTO_OWNER_KINDS as readonly string[]).includes(ownerKindRaw)) {
    throw new Error(`owner_kind must be one of ${PHOTO_OWNER_KINDS.join(", ")}, got ${JSON.stringify(ownerKindRaw)}`);
  }
  const ownerKind = ownerKindRaw as PhotoOwnerKind;
  const ownerId = decodeOwnerId(ownerKind, cellString(row, 1, "owner_id"));
  const dataUrl = cellString(row, 2, "data_url");
  if (dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
    // A cell physically cannot hold this many characters, so a row read
    // back this long could only come from something other than this app
    // (or a future raised limit) — refuse it rather than trusting it.
    throw new Error(
      `data_url is ${dataUrl.length} characters, over the ${MAX_PHOTO_DATA_URL_LENGTH}-character Google Sheets cell limit`,
    );
  }
  const updatedAt = makeIsoTimestamp(cellString(row, 3, "updated_at"));
  return { ownerKind, ownerId, dataUrl, updatedAt };
}
