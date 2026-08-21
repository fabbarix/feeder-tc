// The image pipeline (WP-PHOTO — DESIGN_PHOTOS.md §6). Deliberately its own
// top-level package, NOT under src/domain/**: the encoder touches real
// browser APIs (canvas, createImageBitmap, FileReader), which a pure,
// I/O-free domain module must never depend on (HANDOVER §5). The
// byte-budget SEARCH logic the encoder wraps is still pure and
// unit-testable on its own — see byte-budget.ts.
export {
  BYTE_BUDGET,
  DOWNSCALE_LADDER,
  DOWNSCALE_QUALITY,
  encodeAttempts,
  pickUnderBudget,
  QUALITY_LADDER,
  TARGET_SIZE_PX,
  type BudgetResult,
  type EncodeAttempt,
} from "./byte-budget.ts";
export { encodePhotoDataUrl, type EncodePhotoOptions } from "./encode.ts";
export { getPhotoDataUrl } from "./read.ts";
