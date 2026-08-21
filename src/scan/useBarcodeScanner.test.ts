import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBarcodeScanner } from "./useBarcodeScanner.ts";

vi.mock("./camera.ts", async () => {
  const actual = await vi.importActual<typeof import("./camera.ts")>("./camera.ts");
  return {
    ...actual,
    startCameraStream: vi.fn(),
    stopCameraStream: vi.fn(),
  };
});

vi.mock("./capabilities.ts", () => ({
  isBarcodeDetectorSupported: () => false,
}));

const { startCameraStream, stopCameraStream } = await import("./camera.ts");

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

describe("useBarcodeScanner — decoder-unavailable (coordinator follow-up on PR #32)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("reports 'decoder-unavailable' — not a silently-retried per-frame failure — when the WASM fallback can't be readied (e.g. offline, never cached)", async () => {
    vi.stubGlobal("HTMLMediaElement", HTMLMediaElement);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.mocked(startCameraStream).mockResolvedValue(fakeStream());

    vi.doMock("./wasm-decoder.ts", () => ({
      ensureWasmDecoderReady: () => Promise.reject(new Error("Failed to fetch the barcode decoder (offline).")),
      decodeBarcodeFromImageData: vi.fn(),
    }));

    const videoRef = createRef<HTMLVideoElement | null>();
    const video = document.createElement("video");
    (videoRef as { current: HTMLVideoElement | null }).current = video;

    const onDetected = vi.fn();
    const { result } = renderHook(() => useBarcodeScanner(videoRef, true, onDetected));

    await waitFor(() => expect(result.current.status).toBe("decoder-unavailable"));
    expect(result.current.errorMessage).toMatch(/offline/i);
    // The camera stream is stopped once the decoder is known unusable —
    // no point leaving the in-use indicator lit for a screen that has
    // already given up (see useBarcodeScanner.ts's catch block).
    expect(stopCameraStream).toHaveBeenCalled();
  });

  it("reaches 'scanning' normally when the WASM decoder readies successfully", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.mocked(startCameraStream).mockResolvedValue(fakeStream());

    vi.doMock("./wasm-decoder.ts", () => ({
      ensureWasmDecoderReady: () => Promise.resolve(),
      decodeBarcodeFromImageData: vi.fn().mockResolvedValue(undefined),
    }));

    const videoRef = createRef<HTMLVideoElement | null>();
    const video = document.createElement("video");
    (videoRef as { current: HTMLVideoElement | null }).current = video;

    const { result, unmount } = renderHook(() => useBarcodeScanner(videoRef, true, vi.fn()));

    await waitFor(() => expect(result.current.status).toBe("scanning"));
    expect(result.current.usingWasmFallback).toBe(true);
    act(() => unmount());
  });
});
