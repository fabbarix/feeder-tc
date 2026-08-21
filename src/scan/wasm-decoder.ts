/**
 * WASM barcode decoder fallback (M6 — coordinator decision: "WASM fallback
 * lazily loaded... reached only when the scan route is opened AND
 * BarcodeDetector is absent, contributing zero bytes to the initial
 * chunk").
 *
 * THIS MODULE MUST NEVER BE STATICALLY IMPORTED. Every caller reaches it via
 * `await import("./wasm-decoder.ts")`, and only after
 * `capabilities.ts#isBarcodeDetectorSupported()` has already returned
 * false — see `useBarcodeScanner.ts`. Importing `zxing-wasm` here (rather
 * than in `detector.ts` or the scan route directly) is what makes that a
 * separate Rollup chunk: a dynamic-import target and everything it
 * transitively imports is split out of the entry chunk automatically,
 * with no manual `manualChunks` config needed. Verified by `npm run
 * build`'s own chunk listing — see the M6 handover report for the before/
 * after sizes.
 *
 * `zxing-wasm`'s default `locateFile` fetches the `.wasm` binary from the
 * jsDelivr CDN (see its README) — wrong for an offline-first PWA (no
 * third-party runtime dependency, HANDOVER §4 invariant 7's spirit) and
 * wrong for CI (no real network calls). The `?url` import below makes Vite
 * bundle the `.wasm` file as a same-origin, hashed asset instead, and
 * `prepareZXingModule`'s `overrides.locateFile` is pointed at it explicitly.
 */
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
// Vite's generic `declare module '*?url'` (vite/client.d.ts) resolves this to
// a same-origin, hashed asset URL string at build time, not a JS module.
import zxingReaderWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

let prepared = false;

/** Idempotent — safe to call on every decode attempt; only the first call actually configures the module. */
function ensurePrepared(): void {
  if (prepared) return;
  prepared = true;
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? zxingReaderWasmUrl : prefix + path),
    },
  });
}

/**
 * Decodes retail barcodes (EAN/UPC family + Code 128/ITF/Codabar) from one
 * captured frame. Returns the first result's text, or `undefined` if none
 * was found — never throws on "no barcode in this frame", since that is the
 * overwhelmingly common case in a decode loop (see `useBarcodeScanner.ts`).
 */
export async function decodeBarcodeFromImageData(imageData: ImageData): Promise<string | undefined> {
  ensurePrepared();
  const results = await readBarcodes(imageData, {
    formats: ["AllRetail"],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  return results[0]?.text;
}
