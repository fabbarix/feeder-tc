/**
 * Decoder/camera capability checks (M6 — DESIGN_PRODUCTS.md §1, coordinator
 * decision "Decoder: BarcodeDetector where available, WASM fallback lazily
 * loaded").
 *
 * Deliberately its own tiny module, not folded into `detector.ts`/
 * `camera.ts`: `useBarcodeScanner.ts` needs to answer "which path do I take"
 * BEFORE it decides whether to `import("./wasm-decoder.ts")` at all — the
 * whole point of the dynamic import (kept out of the initial bundle, see
 * that module's own header) is that this check has to happen first, with
 * zero cost, so Chrome/Android (which has `BarcodeDetector`) never even
 * requests the WASM chunk.
 */

/** True on Chrome/Android and other browsers shipping the Shape Detection API; false on Safari/iOS and Firefox. */
export function isBarcodeDetectorSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

/** False when the browser has no camera API at all (very old browsers, non-secure contexts) — distinct from "has the API but no physical camera", which only `getUserMedia` itself can tell us (see camera.ts). */
export function hasMediaDevicesSupport(): boolean {
  return typeof navigator !== "undefined" && navigator.mediaDevices !== undefined && typeof navigator.mediaDevices.getUserMedia === "function";
}
