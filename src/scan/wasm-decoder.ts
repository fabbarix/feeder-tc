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
 * wrong for CI (no real network calls). `wasm-asset-url.ts`'s `?url` import
 * makes Vite bundle the `.wasm` file as a same-origin, hashed asset
 * instead, and `prepareZXingModule`'s `overrides.locateFile` is pointed at
 * it explicitly. `vite.config.ts` additionally registers a `CacheFirst`
 * runtime-caching route for that same URL pattern, and
 * `warm-wasm-decoder.ts` opportunistically primes it — see that file for
 * why (coordinator follow-up on PR #32: a cold fetch of this ~464 KB
 * gzip file while standing in a shop with bad signal is exactly the
 * failure this app's "offline-first" brief exists to prevent).
 */
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { zxingReaderWasmUrl } from "./wasm-asset-url.ts";

/**
 * A stable object reference, not an inline literal per call:
 * `prepareZXingModule` reuses its cached module promise only when the
 * `overrides` object passed in `shallow`-equals the previously cached one
 * (see zxing-wasm's own `PrepareZXingModuleOptions.equalityFn` doc
 * comment) — a fresh `{ locateFile: (path) => ... }` object literal on
 * every call would never `Object.is`-equal a previous one (function
 * identity differs each time), defeating that cache and re-triggering
 * instantiation on every single call. Defining this once at module scope
 * is what makes `ensureWasmDecoderReady`/`decodeBarcodeFromImageData`
 * actually idempotent after the first successful call.
 */
const ZXING_MODULE_OVERRIDES = {
  locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? zxingReaderWasmUrl : prefix + path),
};

/**
 * Forces the WASM module to actually fetch and instantiate NOW, and throws
 * if that fails (e.g. offline and the file was never cached) — called once,
 * eagerly, before `useBarcodeScanner.ts` starts its decode loop, so a
 * genuine "the decoder isn't available" failure surfaces as a single clear
 * error the caller can show a real message for, rather than as a silent,
 * endlessly-retried per-frame failure (coordinator follow-up on PR #32:
 * "never a spinner that goes nowhere").
 */
export async function ensureWasmDecoderReady(): Promise<void> {
  await prepareZXingModule({ overrides: ZXING_MODULE_OVERRIDES, fireImmediately: true });
}

/**
 * Decodes retail barcodes (EAN/UPC family + Code 128/ITF/Codabar) from one
 * captured frame. Returns the first result's text, or `undefined` if none
 * was found — never throws on "no barcode in this frame", since that is the
 * overwhelmingly common case in a decode loop (see `useBarcodeScanner.ts`).
 * Assumes `ensureWasmDecoderReady` already succeeded once for this session
 * (`prepareZXingModule`'s own cache makes calling it again here practically
 * free either way).
 */
export async function decodeBarcodeFromImageData(imageData: ImageData): Promise<string | undefined> {
  prepareZXingModule({ overrides: ZXING_MODULE_OVERRIDES });
  const results = await readBarcodes(imageData, {
    formats: ["AllRetail"],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  return results[0]?.text;
}
