/**
 * The scan route's camera/decode hook (M6 — DESIGN_PRODUCTS.md §1).
 *
 * Owns the whole "camera permission, live decode, a clear failure path"
 * lifecycle: requests the camera, picks a decoder (native `BarcodeDetector`
 * where available, the lazily-loaded WASM fallback otherwise — coordinator
 * decision, see `src/scan/wasm-decoder.ts`'s header for why that import is
 * dynamic), polls frames on an interval, and reports one of several
 * statuses a route can render distinct UI for — including
 * `"decoder-unavailable"`, a genuinely different failure from `"denied"`/
 * `"unavailable"`: the camera itself works, but the WASM fallback couldn't
 * be fetched/instantiated (offline, never cached — see
 * `warm-wasm-decoder.ts`), detected once, up front, rather than retried
 * silently forever inside the decode loop. Manual barcode entry is NOT part of
 * this hook — it has nothing to do with the camera and is always available
 * regardless of `status` (the scan route renders it unconditionally, so
 * there is never a dead end).
 *
 * Browser I/O (`getUserMedia`, `<video>`, `BarcodeDetector`/canvas) — same
 * reasoning as `src/photos/**` for living outside `src/domain/**` (must
 * stay I/O-free) and outside `src/ui/**` (not presentational; a route's
 * container hook, exactly like `usePantryInventory`/`useShoppingList`).
 *
 * Takes the `<video>` ref as a PARAMETER rather than creating and returning
 * one — deliberately, not just style: `eslint-plugin-react-hooks`' newer
 * (React Compiler-derived) `refs` rule statically flags *any* property read
 * off a hook's returned object once that object also carries a ref field,
 * even totally ref-unrelated ones like `status`/`retry` — it cannot prove
 * the object isn't itself ref-shaped. Accepting the ref as an argument
 * (the caller's own `useRef`, attached directly to its `<video>`) means
 * this hook's return value is plain reactive state with no ref in it at
 * all, and the false-positive disappears rather than needing a lint
 * disable.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  CameraPermissionDeniedError,
  CameraUnavailableError,
  CameraUnsupportedError,
  startCameraStream,
  stopCameraStream,
} from "./camera.ts";
import { isBarcodeDetectorSupported } from "./capabilities.ts";
import { createNativeBarcodeDetector, detectBarcodes, type BarcodeDetectorLike } from "./detector.ts";

export type ScannerStatus =
  | "idle"
  | "starting"
  | "scanning"
  | "denied"
  | "unavailable"
  | "decoder-unavailable"
  | "error";

export interface UseBarcodeScannerResult {
  /** `"idle"` whenever `enabled` is false, regardless of whatever the camera was doing before it was disabled. */
  readonly status: ScannerStatus;
  readonly errorMessage: string | undefined;
  /** True once the WASM fallback has taken over decoding (Safari/iOS, Firefox) — surfaced only for the report/telemetry-style "which path ran" question, not required by any UI. */
  readonly usingWasmFallback: boolean;
  /** Re-attempts starting the camera (e.g. after the user grants permission via the browser's own UI and comes back). */
  readonly retry: () => void;
}

const DECODE_INTERVAL_MS = 350;
/** Frames are downscaled to this width before the WASM decoder runs on them — full camera resolution (often 1920px+) makes every decode attempt needlessly slow. */
const WASM_FRAME_WIDTH = 640;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useBarcodeScanner(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onDetected: (rawValue: string) => void,
): UseBarcodeScannerResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [usingWasmFallback, setUsingWasmFallback] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  // Always call the LATEST onDetected without re-running the whole
  // start/stop effect on every render — same ref-indirection pattern as
  // usePantryInventory.ts's handleFlushResultRef.
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    // No synchronous setState here when disabled (react-hooks/set-state-in-effect):
    // the publicly returned `status` below already forces "idle" whenever
    // `enabled` is false, regardless of whatever `status` state was last
    // set to — see the return statement.
    if (!enabled) return;

    let cancelled = false;
    let stream: MediaStream | undefined;
    let intervalId: number | undefined;

    async function decodeOneFrame(
      video: HTMLVideoElement,
      detector: BarcodeDetectorLike | undefined,
      wasmModule: typeof import("./wasm-decoder.ts") | undefined,
    ): Promise<string | undefined> {
      if (detector) {
        const results = await detectBarcodes(detector, video);
        return results[0];
      }
      if (!wasmModule) return undefined;
      // WASM path: draw the current frame to a small offscreen canvas, then
      // hand ImageData to the already-loaded-and-ready decoder (see
      // `start()` below — the module is imported and instantiated ONCE,
      // before this loop starts, specifically so a fetch/instantiation
      // failure surfaces as a single clear error rather than a silently
      // retried per-frame one).
      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      const canvas = canvasRef.current;
      const scale = video.videoWidth > 0 ? Math.min(1, WASM_FRAME_WIDTH / video.videoWidth) : 1;
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return undefined;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return wasmModule.decodeBarcodeFromImageData(imageData);
    }

    async function start(): Promise<void> {
      setStatus("starting");
      setErrorMessage(undefined);
      let decoderAttempted = false;
      try {
        stream = await startCameraStream();
        if (cancelled) {
          stopCameraStream(stream);
          return;
        }
        const video = videoRef.current;
        if (!video) throw new Error("Scanner video element is not mounted.");
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        let detector: BarcodeDetectorLike | undefined;
        let wasmModule: typeof import("./wasm-decoder.ts") | undefined;
        if (isBarcodeDetectorSupported()) {
          detector = createNativeBarcodeDetector();
        } else {
          // Imported and made ready ONCE, up front — a fetch/instantiation
          // failure (offline, never cached — see warm-wasm-decoder.ts for
          // the mitigation) throws HERE, in the same try/catch as the
          // camera-permission errors below, instead of inside the decode
          // loop where it would otherwise be swallowed as "no barcode in
          // this frame" and retried forever (coordinator follow-up on PR
          // #32: "never a spinner that goes nowhere"). `decoderAttempted`
          // is what lets the catch block below tell "the decoder itself
          // couldn't be readied" apart from any other unrelated error
          // (e.g. the video-element guard just above).
          decoderAttempted = true;
          wasmModule = await import("./wasm-decoder.ts");
          await wasmModule.ensureWasmDecoderReady();
          if (cancelled) return;
          setUsingWasmFallback(true);
        }

        setStatus("scanning");

        let busy = false;
        intervalId = window.setInterval(() => {
          if (busy || cancelled) return;
          const currentVideo = videoRef.current;
          if (!currentVideo || currentVideo.readyState < currentVideo.HAVE_CURRENT_DATA) return;
          busy = true;
          decodeOneFrame(currentVideo, detector, wasmModule)
            .then((raw) => {
              if (raw && !cancelled) onDetectedRef.current(raw);
            })
            .catch(() => {
              // A single failed decode TICK past this point (a blurry/empty
              // frame, a transient WASM hiccup) is not fatal — the loop
              // just tries again next tick. This is deliberately narrower
              // than before: the one failure mode that used to hide here
              // (the decoder never became available at all) can no longer
              // reach this catch — it already threw above, before the
              // loop started.
            })
            .finally(() => {
              busy = false;
            });
        }, DECODE_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        if (stream) {
          // No working decoder (denied/no-camera/decoder-unavailable) means
          // there is nothing useful this stream can still do — stop it
          // immediately rather than leaving the camera's in-use indicator
          // lit for a screen that has already given up.
          stopCameraStream(stream);
          stream = undefined;
        }
        if (err instanceof CameraPermissionDeniedError) {
          setStatus("denied");
        } else if (err instanceof CameraUnavailableError || err instanceof CameraUnsupportedError) {
          setStatus("unavailable");
        } else if (decoderAttempted) {
          setStatus("decoder-unavailable");
          setErrorMessage(messageOf(err));
        } else {
          setStatus("error");
          setErrorMessage(messageOf(err));
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
      if (stream) stopCameraStream(stream);
    };
  }, [enabled, retryToken, videoRef]);

  return {
    status: enabled ? status : "idle",
    errorMessage,
    usingWasmFallback,
    retry: () => setRetryToken((t) => t + 1),
  };
}
