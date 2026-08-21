import { afterEach, describe, expect, it } from "vitest";
import { createNativeBarcodeDetector, detectBarcodes } from "./detector.ts";

describe("createNativeBarcodeDetector", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "BarcodeDetector");
  });

  it("throws when BarcodeDetector is unavailable", () => {
    expect(() => createNativeBarcodeDetector()).toThrow(/not available/);
  });

  it("constructs the native detector restricted to retail formats", () => {
    let capturedOptions: { formats?: readonly string[] } | undefined;
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      constructor(options?: { formats?: readonly string[] }) {
        capturedOptions = options;
      }
      detect(): Promise<never[]> {
        return Promise.resolve([]);
      }
    };
    createNativeBarcodeDetector();
    expect(capturedOptions?.formats).toContain("ean_13");
    expect(capturedOptions?.formats).toContain("upc_a");
  });
});

describe("detectBarcodes", () => {
  it("maps detection results to their rawValue strings", async () => {
    const detector = {
      detect: () => Promise.resolve([{ rawValue: "8001120000123" }, { rawValue: "0000000000000" }]),
    };
    const values = await detectBarcodes(detector, {} as CanvasImageSource);
    expect(values).toEqual(["8001120000123", "0000000000000"]);
  });

  it("returns an empty array when nothing was detected", async () => {
    const detector = { detect: () => Promise.resolve([]) };
    const values = await detectBarcodes(detector, {} as CanvasImageSource);
    expect(values).toEqual([]);
  });
});
