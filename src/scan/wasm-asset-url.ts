/**
 * The barcode WASM binary's build-time asset URL — its OWN tiny module,
 * deliberately split out of `wasm-decoder.ts`.
 *
 * `wasm-decoder.ts` needs this to point `prepareZXingModule` at a same-
 * origin file instead of zxing-wasm's default jsDelivr CDN fetch.
 * `warm-wasm-decoder.ts` ALSO needs it — to opportunistically prime the
 * service worker's cache for this one file, on browsers that lack
 * `BarcodeDetector`, before the user is standing in a shop with bad signal
 * (coordinator follow-up on PR #32). Importing the URL from
 * `wasm-decoder.ts` for that second use would pull in `zxing-wasm/reader`'s
 * whole JS wrapper (and, via its own imports, everything needed to
 * INSTANTIATE the module) just to read a string — wasted work for code
 * whose entire job is "warm the cache, don't run the decoder yet".
 *
 * This module is intentionally eager-importable (small — a build-time
 * constant string, nothing else) unlike `wasm-decoder.ts`, which must
 * never be imported outside a dynamic `import()` (see that file's header).
 */
// Vite's generic `declare module '*?url'` (vite/client.d.ts) resolves this to
// a same-origin, hashed asset URL string at build time, not a JS module —
// the actual .wasm bytes are never pulled into this module's own output.
import zxingReaderWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

export { zxingReaderWasmUrl };
