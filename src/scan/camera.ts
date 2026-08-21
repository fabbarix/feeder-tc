/**
 * Camera stream lifecycle (M6 — DESIGN_PRODUCTS.md §1: "camera permission,
 * live decode, a clear failure path when permission is denied or no camera
 * exists"). A thin wrapper over `getUserMedia`, deliberately outside
 * `src/domain/**` (real browser I/O, same reasoning as `src/photos/encode.ts`
 * living outside the pure domain layer — HANDOVER §5) and outside
 * `src/ui/**` (it is not presentational; `useBarcodeScanner.ts` is the hook
 * that a route mounts).
 *
 * Distinguishes "no camera API at all" from "camera denied" from "no
 * physical camera" via `DOMException.name` — the three outcomes the scan
 * route needs to render three different messages for, all with the same
 * always-available manual-entry fallback (never a dead end).
 */

export class CameraUnsupportedError extends Error {
  constructor() {
    super("This browser has no camera API (getUserMedia unavailable).");
    this.name = "CameraUnsupportedError";
  }
}

export class CameraPermissionDeniedError extends Error {
  constructor() {
    super("Camera permission was denied.");
    this.name = "CameraPermissionDeniedError";
  }
}

export class CameraUnavailableError extends Error {
  constructor(message = "No usable camera was found on this device.") {
    super(message);
    this.name = "CameraUnavailableError";
  }
}

/**
 * Requests the rear ("environment") camera when one exists, falling back to
 * whatever camera is available otherwise (a laptop only has a front
 * camera). Throws one of the typed errors above rather than the raw
 * `DOMException` so callers can `instanceof`-branch without knowing
 * `getUserMedia`'s error-name vocabulary.
 */
export async function startCameraStream(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia === undefined) {
    throw new CameraUnsupportedError();
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : undefined;
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
      throw new CameraPermissionDeniedError();
    }
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
      throw new CameraUnavailableError();
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** Stops every track — always call on unmount/cleanup so the browser's camera-in-use indicator turns off. */
export function stopCameraStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
