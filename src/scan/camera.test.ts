import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CameraPermissionDeniedError,
  CameraUnavailableError,
  CameraUnsupportedError,
  startCameraStream,
  stopCameraStream,
} from "./camera.ts";

function stubGetUserMedia(impl: (constraints: MediaStreamConstraints) => Promise<MediaStream>): void {
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: impl },
    configurable: true,
  });
}

describe("startCameraStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws CameraUnsupportedError when there is no camera API at all", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    await expect(startCameraStream()).rejects.toBeInstanceOf(CameraUnsupportedError);
  });

  it("throws CameraPermissionDeniedError on NotAllowedError", async () => {
    stubGetUserMedia(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    await expect(startCameraStream()).rejects.toBeInstanceOf(CameraPermissionDeniedError);
  });

  it("throws CameraUnavailableError on NotFoundError (no physical camera)", async () => {
    stubGetUserMedia(() => Promise.reject(new DOMException("none", "NotFoundError")));
    await expect(startCameraStream()).rejects.toBeInstanceOf(CameraUnavailableError);
  });

  it("resolves with the stream on success", async () => {
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    stubGetUserMedia(() => Promise.resolve(fakeStream));
    await expect(startCameraStream()).resolves.toBe(fakeStream);
  });

  it("requests the environment-facing camera", async () => {
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream));
    stubGetUserMedia(getUserMedia);
    await startCameraStream();
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: expect.objectContaining({ facingMode: { ideal: "environment" } }) }),
    );
  });
});

describe("stopCameraStream", () => {
  it("stops every track", () => {
    const stop1 = vi.fn();
    const stop2 = vi.fn();
    const stream = { getTracks: () => [{ stop: stop1 }, { stop: stop2 }] } as unknown as MediaStream;
    stopCameraStream(stream);
    expect(stop1).toHaveBeenCalled();
    expect(stop2).toHaveBeenCalled();
  });
});
