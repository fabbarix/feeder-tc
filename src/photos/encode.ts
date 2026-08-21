/**
 * The photo encoder's write path (WP-PHOTO — DESIGN_PHOTOS.md §4/§6):
 * source image -> resize to <=512px longest side -> WebP, under the 32 KB
 * byte budget from byte-budget.ts, enforced by measuring each attempt's
 * actual output (never by trusting a quality number alone — see that
 * module's own doc comment for why).
 *
 * Deliberately NOT under `src/domain/**`: this module calls
 * `createImageBitmap`, `document.createElement("canvas")`,
 * `HTMLCanvasElement.toBlob`, and `FileReader` — real browser APIs with no
 * equivalent in a pure, I/O-free domain module (HANDOVER §5: "Domain
 * engines are pure modules (no I/O, no React, no globals)"). Putting it
 * here instead of forcing `src/domain` to grow a browser dependency is the
 * honest split the task brief asks for; the actual byte-budget SEARCH logic
 * this wraps is still pure and lives in byte-budget.ts, unit-testable with
 * no canvas at all.
 *
 * PNG is never produced: the design's rejection of PNG as an output format
 * (DESIGN_PHOTOS.md §4 — "lossless, built for flat graphics, 5-10x larger
 * on photographs") is enforced simply by this encoder always requesting
 * "image/webp" from `canvas.toBlob`, regardless of the source image's own
 * format (JPEG/PNG/HEIC/whatever a camera or file picker hands it).
 */
import { BYTE_BUDGET, pickUnderBudget, type EncodeAttempt } from "./byte-budget.ts";

export interface EncodePhotoOptions {
  /** Overrides BYTE_BUDGET — mainly for tests; production callers should use the default. */
  readonly budgetBytes?: number;
}

function resizedCanvas(source: ImageBitmap, sizePx: number): HTMLCanvasElement {
  const longestSide = Math.max(source.width, source.height);
  const scale = Math.min(1, sizePx / longestSide);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

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

function canvasToWebpBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob produced no blob (WebP encoding failed)."));
      },
      "image/webp",
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

async function measureAttempt(source: ImageBitmap, attempt: EncodeAttempt): Promise<{ bytes: number; result: Blob }> {
  const canvas = resizedCanvas(source, attempt.sizePx);
  const blob = await canvasToWebpBlob(canvas, attempt.quality);
  return { bytes: blob.size, result: blob };
}

/**
 * Encodes `source` (a file/camera capture, any browser-decodable image
 * format) into a WebP data URL sized for the `Photos` sheet: resized to
 * <=512px longest side, walking the quality/downscale ladder in
 * byte-budget.ts until the measured output fits the 32 KB budget (or, on a
 * genuinely pathological source, returning the smallest attempt found —
 * `src/sheets/codecs/photos.ts` is the hard backstop that refuses an
 * oversized `dataUrl` outright rather than this function silently
 * truncating one).
 */
export async function encodePhotoDataUrl(source: Blob, options: EncodePhotoOptions = {}): Promise<string> {
  const bitmap = await createImageBitmap(source);
  try {
    const picked = await pickUnderBudget(
      (attempt) => measureAttempt(bitmap, attempt),
      options.budgetBytes ?? BYTE_BUDGET,
    );
    return await blobToDataUrl(picked.result);
  } finally {
    bitmap.close();
  }
}
