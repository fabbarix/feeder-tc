import { afterEach, describe, expect, it } from "vitest";
import { hasMediaDevicesSupport, isBarcodeDetectorSupported } from "./capabilities.ts";

describe("isBarcodeDetectorSupported", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "BarcodeDetector");
  });

  it("is false when BarcodeDetector is absent (jsdom's default — matches Safari/Firefox)", () => {
    expect(isBarcodeDetectorSupported()).toBe(false);
  });

  it("is true once BarcodeDetector is present (Chrome/Android)", () => {
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {};
    expect(isBarcodeDetectorSupported()).toBe(true);
  });
});

describe("hasMediaDevicesSupport", () => {
  it("is true under jsdom's default navigator.mediaDevices stub", () => {
    // jsdom doesn't implement getUserMedia by default, but some environments
    // still expose the mediaDevices object without the method — the
    // function must check for the method itself, not just the namespace.
    expect(typeof hasMediaDevicesSupport()).toBe("boolean");
  });

  it("is false when getUserMedia is not a function", () => {
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {},
      configurable: true,
    });
    expect(hasMediaDevicesSupport()).toBe(false);
    Object.defineProperty(navigator, "mediaDevices", { value: original, configurable: true });
  });

  it("is true when getUserMedia is a function", () => {
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    expect(hasMediaDevicesSupport()).toBe(true);
    Object.defineProperty(navigator, "mediaDevices", { value: original, configurable: true });
  });
});
