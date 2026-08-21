/**
 * Opportunistic warming for the barcode WASM fallback (coordinator follow-up
 * on PR #32).
 *
 * The gap: `vite.config.ts`'s service-worker precache deliberately does NOT
 * include the ~1 MB `.wasm` binary (constraint from the same follow-up —
 * that would push 464 KB gzip onto every install, including every Android
 * user who never needs it). But that means the FIRST time a Safari/iOS
 * household opens the scanner, the fallback decoder has to fetch that file
 * live — and Feeder's whole brief is a household standing in a shop with
 * bad signal. A cold, ~464 KB gzip fetch at exactly that moment is a
 * failure mode this app exists to prevent.
 *
 * The fix is not "cache it always" (that's the precache mistake) or "fetch
 * it when the scan route mounts" (defensible, but arguably already too
 * late — the household is likely already at the shop by the time they open
 * the scanner for the first time). Instead: as soon as the app is USABLE
 * (signed in, workbook loaded — typically at home, on the household's own
 * connection, before any shopping trip), and only on a browser that will
 * actually need the fallback, quietly prime the same URL
 * `vite.config.ts`'s `CacheFirst` runtime-caching route serves from. A
 * plain `fetch()` while that route is registered is enough — the service
 * worker intercepts it and stores the response, with no need to import the
 * decoder module or instantiate anything.
 *
 * `shouldWarmBarcodeDecoder` is pulled out as a pure function so the
 * decision logic (three real-world constraints: never on a browser that
 * doesn't need it, never fully offline, never on a save-data/metered
 * connection where detectable) is unit-testable without a real
 * fetch/`requestIdleCallback`/`navigator.connection`.
 */
import { isBarcodeDetectorSupported } from "./capabilities.ts";
import { zxingReaderWasmUrl } from "./wasm-asset-url.ts";

export interface ConnectionSignal {
  /** User has explicitly asked their browser to reduce data usage. */
  readonly saveData?: boolean;
  /** Coarse-grained bucket the Network Information API reports; only "slow-2g"/"2g" are treated as "too slow to warm on". */
  readonly effectiveType?: string;
}

export interface WarmDecision {
  readonly barcodeDetectorSupported: boolean;
  readonly online: boolean;
  readonly connection?: ConnectionSignal;
}

const SLOW_EFFECTIVE_TYPES = new Set(["slow-2g", "2g"]);

/**
 * Pure policy: warm only when (a) this browser will actually need the WASM
 * fallback — Chrome/Android with `BarcodeDetector` never runs this, saving
 * every one of those installs a request they'd never need anyway — (b)
 * there is a network to fetch from at all, and (c) that network isn't
 * flagged as save-data or a 2G-class connection, WHERE THAT CAN BE DETECTED
 * — the Network Information API (`navigator.connection`) is Chrome/Android-
 * only; Safari and Firefox (the two browsers that actually lack
 * `BarcodeDetector` and therefore reach this function with `connection`
 * undefined) have never implemented it. `connection` is `undefined` in
 * exactly that case, and this function passes it through as "can't tell,
 * so don't block on it" — this is a real, load-bearing gap, not an
 * oversight; see this module's own report for the exact browsers affected.
 */
export function shouldWarmBarcodeDecoder({ barcodeDetectorSupported, online, connection }: WarmDecision): boolean {
  if (barcodeDetectorSupported) return false;
  if (!online) return false;
  if (connection?.saveData) return false;
  if (connection?.effectiveType !== undefined && SLOW_EFFECTIVE_TYPES.has(connection.effectiveType)) return false;
  return true;
}

/** `requestIdleCallback` with a `setTimeout` fallback — Safari has never implemented `requestIdleCallback` either, and Safari is exactly the browser this warming exists for. */
function runWhenIdle(fn: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback;
  if (ric) {
    ric(fn, { timeout: 4000 });
  } else {
    setTimeout(fn, 1500);
  }
}

function readConnectionSignal(): ConnectionSignal | undefined {
  const connection = (navigator as unknown as { connection?: ConnectionSignal }).connection;
  if (!connection) return undefined;
  return {
    ...(connection.saveData !== undefined ? { saveData: connection.saveData } : {}),
    ...(connection.effectiveType !== undefined ? { effectiveType: connection.effectiveType } : {}),
  };
}

let warmed = false;

/**
 * Fire-and-forget: schedules a background fetch of the barcode WASM binary
 * once the browser is idle, if `shouldWarmBarcodeDecoder` says to. Never
 * throws, never blocks its caller, never runs twice in one page session —
 * `App.tsx`'s `ShellContainer` calls this once, as soon as the shell
 * reaches "ready" (signed in, workbook loaded), NOT gated behind the user
 * ever opening `/scan`.
 */
export function warmBarcodeDecoderIfNeeded(): void {
  if (warmed) return;
  const connection = readConnectionSignal();
  const decision: WarmDecision = {
    barcodeDetectorSupported: isBarcodeDetectorSupported(),
    online: navigator.onLine,
    ...(connection !== undefined ? { connection } : {}),
  };
  if (!shouldWarmBarcodeDecoder(decision)) return;
  warmed = true;
  runWhenIdle(() => {
    // A plain fetch is enough to prime the SW's CacheFirst route
    // (vite.config.ts) — no need to import the decoder module or run
    // anything. Failure here (still offline, a flaky connection) is not
    // reported anywhere: this is a pure best-effort optimisation, and the
    // real, honest failure path lives in `useBarcodeScanner.ts` /
    // `ensureWasmDecoderReady` for the moment the user actually tries to
    // scan.
    void fetch(zxingReaderWasmUrl, { cache: "force-cache" }).catch(() => undefined);
  });
}

/** Test-only: lets a test observe a fresh `warmBarcodeDecoderIfNeeded()` call instead of the real one-shot-per-session guard. */
export function resetWarmedForTest(): void {
  warmed = false;
}
