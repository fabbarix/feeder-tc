/**
 * Native `BarcodeDetector` wrapper (M6 — coordinator decision: "Decoder:
 * `BarcodeDetector` where available"). Chrome/Android ships this as part of
 * the Shape Detection API; TypeScript's own DOM lib does not declare it yet
 * (as of the TS version pinned here), so this module carries the minimal
 * ambient type it needs rather than pulling in a third-party `@types`
 * package for a handful of members.
 *
 * Deliberately synchronous to construct (`new BarcodeDetector(...)` does no
 * I/O) — contrast `src/scan/wasm-decoder.ts`, whose module itself is the
 * thing lazily `import()`-ed, precisely because it prepares a WASM module
 * this constructor never needs to.
 */

/** Ambient shape for the subset of the Shape Detection API this app uses — not in TypeScript's lib.dom.d.ts yet. */
interface DetectedBarcodeLike {
  readonly rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<readonly DetectedBarcodeLike[]>;
}
interface BarcodeDetectorConstructorLike {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
}

/** Retail-only formats (EAN/UPC + Code 128, seen on some house-brand/bulk labels) — narrower than "every format" for faster per-frame detection. */
const RETAIL_FORMATS: readonly string[] = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf", "codabar"];

export function createNativeBarcodeDetector(): BarcodeDetectorLike {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructorLike }).BarcodeDetector;
  if (!ctor) {
    throw new Error("BarcodeDetector is not available in this browser — check capabilities.ts first.");
  }
  return new ctor({ formats: RETAIL_FORMATS });
}

/** Runs one detection pass over a video frame, returning every decoded string (usually zero or one). */
export async function detectBarcodes(detector: BarcodeDetectorLike, source: CanvasImageSource): Promise<readonly string[]> {
  const results = await detector.detect(source);
  return results.map((r) => r.rawValue);
}

export type { BarcodeDetectorLike };
