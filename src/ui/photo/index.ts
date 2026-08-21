/**
 * Shared photo UI primitives (WP-PHOTO UI — DESIGN_PHOTOS.md). A separate
 * barrel from `src/ui/components` (rather than folding these two in there)
 * so a future product-photo affordance (M6/M6-barcode) can find "the photo
 * stuff" as one obvious import, without hunting through the whole general
 * kit — both components are written to be entity-agnostic (`kind:
 * "product"` already handled) and SHOULD be reused there rather than
 * duplicated.
 */
export { PhotoMedia } from "./PhotoMedia.tsx";
export type { PhotoMediaProps, PhotoSize } from "./PhotoMedia.tsx";

export { PhotoField } from "./PhotoField.tsx";
export type { PhotoDraft, PhotoFieldProps } from "./PhotoField.tsx";
