/**
 * Recipe-import-from-a-photo — the model-input encoder, and a cheap
 * client-side glare/shadow advisory. DESIGN_RECIPE_IMPORT_PHOTO.md §3/§6 and
 * "Decisions (owner, 2026-08-24)" §6: "The 512 px / 32 KB stored-photo
 * pipeline is for storage and display. Reading text needs a separate,
 * larger encode used only as model input and discarded — the stored-photo
 * path is untouched."
 *
 * This is a SIBLING to `src/photos/encode.ts`/`byte-budget.ts`, not a
 * modification of either — nothing in `src/photos/**` changes. It is
 * split the same way that pair is split: pure sizing/scoring math in plain
 * functions (unit-testable with no canvas at all) around a thin async
 * wrapper that actually touches `createImageBitmap`/canvas/`FileReader`.
 *
 * No byte-budget search loop (unlike `src/photos/encode.ts`): there is no
 * tight ceiling to hit here. A 1800px JPEG at q0.85 lands at a few hundred
 * KB, comfortably under the API's 50 MiB per-file limit — one encode
 * attempt is enough.
 */

/** Longest side, in px, for a photo sent to the model — DESIGN_RECIPE_IMPORT_PHOTO.md §3: "1600–2000px is the point past which more resolution stops helping." */
export const MODEL_INPUT_MAX_SIZE_PX = 1800;
/** JPEG, not WebP (§3: "the more conservatively-supported format across 'any OpenAI-compatible endpoint'"). */
export const MODEL_INPUT_QUALITY = 0.85;

export interface EncodePhotoForModelOptions {
  /** Overrides `MODEL_INPUT_MAX_SIZE_PX` — mainly for tests. */
  readonly maxSizePx?: number;
  /** Overrides `MODEL_INPUT_QUALITY` — mainly for tests. */
  readonly quality?: number;
}

/**
 * Pure resize math: given a source image's own width/height and a longest-side
 * cap, computes the output width/height — never upscales (a `scale` capped at
 * 1), and never rounds a dimension down to 0. Exactly the same shape as
 * `src/photos/encode.ts`'s own `resizedCanvas` scale computation, pulled out
 * as a standalone function here so it is testable without a canvas.
 */
export function computeResizedDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxSizePx: number,
): { readonly width: number; readonly height: number } {
  const longestSide = Math.max(sourceWidth, sourceHeight);
  const scale = longestSide <= 0 ? 1 : Math.min(1, maxSizePx / longestSide);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob produced no blob (JPEG encoding failed)."));
      },
      "image/jpeg",
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed to read the encoded photo blob."));
    reader.readAsDataURL(blob);
  });
}

function drawResized(source: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context — the browser may not support canvas image encoding.");
  }
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * Encodes `source` (a file/camera capture) into a single JPEG data URL sized
 * for sending to the household's configured address as model input — resized
 * to <=1800px longest side, one JPEG encode at q0.85, no byte-budget search.
 * Never written to the workbook; the caller (`RecipeImport.tsx`) keeps this
 * only in memory/router state for the duration of the import.
 */
export async function encodePhotoForModelDataUrl(source: Blob, options: EncodePhotoForModelOptions = {}): Promise<string> {
  const bitmap = await createImageBitmap(source);
  try {
    const { width, height } = computeResizedDimensions(
      bitmap.width,
      bitmap.height,
      options.maxSizePx ?? MODEL_INPUT_MAX_SIZE_PX,
    );
    const canvas = drawResized(bitmap, width, height);
    const blob = await canvasToJpegBlob(canvas, options.quality ?? MODEL_INPUT_QUALITY);
    return await blobToDataUrl(blob);
  } finally {
    bitmap.close();
  }
}

// ---------------------------------------------------------------------------
// Glare/shadow advisory — DESIGN_RECIPE_IMPORT_PHOTO.md §6's "cheap canvas
// histogram check, not a model call." Advisory only, never blocking: the
// household can always send anyway.
// ---------------------------------------------------------------------------

export type PhotoQualityAdvisoryReason = "glare" | "flat";

export interface PhotoQualityAdvisory {
  readonly flagged: boolean;
  readonly reason?: PhotoQualityAdvisoryReason;
}

/** A sampled pixel at/above this luminance (out of 255) counts as "blown out white" for the glare check. */
const SATURATED_LUMINANCE = 245;
/** If this fraction (or more) of sampled pixels are blown-out white, flag glare. */
const GLARE_FRACTION_THRESHOLD = 0.15;
/** Below this luminance variance, the photo reads as a flat/washed-out shadow rather than genuine page contrast. Tuned against a synthetic "photo of text on paper" sample (high-contrast bimodal luminance, variance in the low thousands) vs. a uniform grey wash (near-zero variance). */
const FLAT_VARIANCE_THRESHOLD = 150;

/**
 * Pure luminance-histogram heuristic — no canvas here, so it is unit-testable
 * against a fabricated luminance table. `luminance` is a flat array of 0-255
 * grayscale samples (typically a downscaled ~100x100 sample of the photo, see
 * `assessPhotoQualityFromBlob` below). Flags either a large contiguous-enough
 * fraction of near-saturated-white pixels (glare/reflection) or very low
 * tonal variance (a flat, washed-out or heavily-shadowed frame). Never both
 * at once — glare is checked first, since a blown-out patch dominates the
 * variance reading anyway.
 */
export function assessPhotoQuality(luminance: ArrayLike<number>): PhotoQualityAdvisory {
  const n = luminance.length;
  if (n === 0) return { flagged: false };

  let sum = 0;
  let saturatedCount = 0;
  for (let i = 0; i < n; i += 1) {
    const value = luminance[i]!;
    sum += value;
    if (value >= SATURATED_LUMINANCE) saturatedCount += 1;
  }
  const saturatedFraction = saturatedCount / n;
  if (saturatedFraction >= GLARE_FRACTION_THRESHOLD) {
    return { flagged: true, reason: "glare" };
  }

  const mean = sum / n;
  let varianceSum = 0;
  for (let i = 0; i < n; i += 1) {
    const delta = luminance[i]! - mean;
    varianceSum += delta * delta;
  }
  const variance = varianceSum / n;
  if (variance <= FLAT_VARIANCE_THRESHOLD) {
    return { flagged: true, reason: "flat" };
  }

  return { flagged: false };
}

/** Small enough that sampling is fast, large enough that a genuine glare spot or a flat wash still shows up reliably. */
const QUALITY_SAMPLE_SIZE_PX = 100;

/**
 * Thin canvas wrapper around `assessPhotoQuality`: downscales `source` to a
 * small (~100x100) sample, reads it back as grayscale luminance via
 * `getImageData`, and runs the pure heuristic above. Runs independently of
 * `encodePhotoForModelDataUrl` (a second, much smaller resize) so the two
 * stay simple, single-purpose functions rather than one that does both jobs.
 */
export async function assessPhotoQualityFromBlob(source: Blob, sampleSizePx = QUALITY_SAMPLE_SIZE_PX): Promise<PhotoQualityAdvisory> {
  const bitmap = await createImageBitmap(source);
  try {
    const { width, height } = computeResizedDimensions(bitmap.width, bitmap.height, sampleSizePx);
    const canvas = drawResized(bitmap, width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get a 2D canvas context — the browser may not support canvas image encoding.");
    }
    const { data } = ctx.getImageData(0, 0, width, height);
    const luminance = new Uint8ClampedArray(width * height);
    for (let i = 0; i < luminance.length; i += 1) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;
      // Standard luma weights (Rec. 601) — the same used everywhere else this codebase would need "how bright does this look".
      luminance[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return assessPhotoQuality(luminance);
  } finally {
    bitmap.close();
  }
}
