/**
 * Pure logic tests for the photo-import model-input encoder's resize math
 * and the glare/shadow advisory heuristic. No canvas involved — same
 * discipline as `src/photos/byte-budget.test.ts`: jsdom has no real
 * canvas/JPEG encoder, so the actual `createImageBitmap`/canvas-touching
 * functions (`encodePhotoForModelDataUrl`, `assessPhotoQualityFromBlob`) are
 * exercised in Playwright instead, against a real browser
 * (e2e/wp-import-photo-recipe-import.spec.ts).
 */
import { describe, expect, it } from "vitest";
import {
  assessPhotoQuality,
  computeResizedDimensions,
  MODEL_INPUT_MAX_SIZE_PX,
  MODEL_INPUT_QUALITY,
} from "./photo-encode.ts";

describe("computeResizedDimensions", () => {
  it("never upscales — a source already under the cap keeps its own size", () => {
    expect(computeResizedDimensions(800, 600, 1800)).toEqual({ width: 800, height: 600 });
  });

  it("downscales a landscape photo so the longest side hits the cap", () => {
    expect(computeResizedDimensions(3600, 2400, 1800)).toEqual({ width: 1800, height: 1200 });
  });

  it("downscales a portrait photo so the longest side (height) hits the cap", () => {
    expect(computeResizedDimensions(2400, 3600, 1800)).toEqual({ width: 1200, height: 1800 });
  });

  it("a square photo scales both dimensions equally", () => {
    expect(computeResizedDimensions(4000, 4000, 1800)).toEqual({ width: 1800, height: 1800 });
  });

  it("never rounds a dimension down to 0 for a pathologically thin source", () => {
    const result = computeResizedDimensions(10000, 1, 1800);
    expect(result.width).toBe(1800);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("the exported defaults match what the design decided (1800px / q0.85)", () => {
    expect(MODEL_INPUT_MAX_SIZE_PX).toBe(1800);
    expect(MODEL_INPUT_QUALITY).toBe(0.85);
  });
});

describe("assessPhotoQuality", () => {
  function makeLuminance(values: readonly number[]): Uint8ClampedArray {
    return Uint8ClampedArray.from(values);
  }

  it("does not flag a normal high-contrast page-of-text sample (bimodal black text on white paper)", () => {
    // Alternating near-white paper and near-black ink — high variance, no
    // large saturated-white blob (only exactly half is near-white and it
    // isn't pinned at the very top of the range).
    const values: number[] = [];
    for (let i = 0; i < 400; i += 1) values.push(i % 2 === 0 ? 235 : 30);
    const result = assessPhotoQuality(makeLuminance(values));
    expect(result.flagged).toBe(false);
  });

  it("flags glare when a large fraction of samples are blown-out white", () => {
    const values: number[] = [];
    for (let i = 0; i < 100; i += 1) values.push(i < 30 ? 255 : 120); // 30% saturated
    const result = assessPhotoQuality(makeLuminance(values));
    expect(result).toEqual({ flagged: true, reason: "glare" });
  });

  it("does not flag glare for a small, incidental bright spot under the threshold", () => {
    const values: number[] = [];
    for (let i = 0; i < 100; i += 1) values.push(i < 5 ? 255 : 120); // 5% saturated
    const result = assessPhotoQuality(makeLuminance(values));
    expect(result.reason).not.toBe("glare");
  });

  it("flags a flat/washed-out sample (near-uniform luminance, low variance)", () => {
    const values = Array.from({ length: 200 }, () => 140); // perfectly flat
    const result = assessPhotoQuality(makeLuminance(values));
    expect(result).toEqual({ flagged: true, reason: "flat" });
  });

  it("does not flag an empty sample", () => {
    expect(assessPhotoQuality(new Uint8ClampedArray(0))).toEqual({ flagged: false });
  });
});
