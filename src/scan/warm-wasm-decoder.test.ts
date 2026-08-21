import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWarmedForTest, shouldWarmBarcodeDecoder, warmBarcodeDecoderIfNeeded } from "./warm-wasm-decoder.ts";

describe("shouldWarmBarcodeDecoder", () => {
  it("never warms when BarcodeDetector is already supported (Chrome/Android never needs the fallback)", () => {
    expect(shouldWarmBarcodeDecoder({ barcodeDetectorSupported: true, online: true })).toBe(false);
  });

  it("never warms while offline — nothing to fetch from", () => {
    expect(shouldWarmBarcodeDecoder({ barcodeDetectorSupported: false, online: false })).toBe(false);
  });

  it("warms when the fallback is needed, online, and no connection signal is available (Safari/Firefox — the Network Information API doesn't exist there)", () => {
    expect(shouldWarmBarcodeDecoder({ barcodeDetectorSupported: false, online: true })).toBe(true);
  });

  it("skips a save-data connection", () => {
    expect(
      shouldWarmBarcodeDecoder({ barcodeDetectorSupported: false, online: true, connection: { saveData: true } }),
    ).toBe(false);
  });

  it("skips a 2G-class connection", () => {
    expect(
      shouldWarmBarcodeDecoder({
        barcodeDetectorSupported: false,
        online: true,
        connection: { effectiveType: "2g" },
      }),
    ).toBe(false);
    expect(
      shouldWarmBarcodeDecoder({
        barcodeDetectorSupported: false,
        online: true,
        connection: { effectiveType: "slow-2g" },
      }),
    ).toBe(false);
  });

  it("warms on a normal 4G/wifi-class connection", () => {
    expect(
      shouldWarmBarcodeDecoder({
        barcodeDetectorSupported: false,
        online: true,
        connection: { effectiveType: "4g", saveData: false },
      }),
    ).toBe(true);
  });
});

describe("warmBarcodeDecoderIfNeeded", () => {
  afterEach(() => {
    resetWarmedForTest();
    Reflect.deleteProperty(window, "BarcodeDetector");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the wasm asset (via the setTimeout fallback, since jsdom has no requestIdleCallback) when the fallback is needed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });

    warmBarcodeDecoderIfNeeded();
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/zxing_reader.*\.wasm/);
    vi.useRealTimers();
  });

  it("never fetches when BarcodeDetector is already supported", async () => {
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {};
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    warmBarcodeDecoderIfNeeded();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only ever fires once per session, even if called repeatedly", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });

    warmBarcodeDecoderIfNeeded();
    warmBarcodeDecoderIfNeeded();
    warmBarcodeDecoderIfNeeded();
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
