/**
 * Pure logic tests for the byte-budget search (WP-PHOTO — DESIGN_PHOTOS.md
 * §4 / DESIGN_PRODUCTS.md §5). No canvas involved: `measure` is a fabricated
 * table of byte sizes per (sizePx, quality) attempt, which is exactly what
 * lets this prove the SEARCH logic — "measure the output, don't trust the
 * quality number" — without a real browser. The real, canvas-driven encoder
 * (encode.ts) is exercised separately, in Playwright (see e2e/) where a
 * genuine WebP encoder is available.
 */
import { describe, expect, it } from "vitest";
import {
  BYTE_BUDGET,
  DOWNSCALE_LADDER,
  DOWNSCALE_QUALITY,
  encodeAttempts,
  pickUnderBudget,
  QUALITY_LADDER,
  TARGET_SIZE_PX,
  type EncodeAttempt,
} from "./byte-budget.ts";

const KB = 1024;

describe("encodeAttempts", () => {
  it("is q85 -> q35 at 512px, then 448/384/320px at a fixed q60, in that order", () => {
    expect(encodeAttempts()).toEqual([
      { sizePx: 512, quality: 0.85 },
      { sizePx: 512, quality: 0.75 },
      { sizePx: 512, quality: 0.65 },
      { sizePx: 512, quality: 0.55 },
      { sizePx: 512, quality: 0.45 },
      { sizePx: 512, quality: 0.35 },
      { sizePx: 448, quality: 0.6 },
      { sizePx: 384, quality: 0.6 },
      { sizePx: 320, quality: 0.6 },
    ]);
    expect(QUALITY_LADDER).toHaveLength(6);
    expect(DOWNSCALE_LADDER).toEqual([448, 384, 320]);
    expect(DOWNSCALE_QUALITY).toBe(0.6);
    expect(TARGET_SIZE_PX).toBe(512);
    expect(BYTE_BUDGET).toBe(32 * KB);
  });
});

describe("pickUnderBudget", () => {
  it("stops at the first attempt whose MEASURED output fits — a typical product shot lands well within q85", async () => {
    // DESIGN_PRODUCTS.md §5's own measured table: "typical product shot" is
    // 4.8 KB at q70, comfortably inside budget even at the very first
    // (highest-quality) attempt.
    const seen: EncodeAttempt[] = [];
    const result = await pickUnderBudget(async (attempt) => {
      seen.push(attempt);
      return { bytes: 5 * KB, result: `blob-at-${attempt.quality}` };
    });
    expect(result.withinBudget).toBe(true);
    expect(result.attempt).toEqual({ sizePx: 512, quality: 0.85 });
    expect(result.bytes).toBe(5 * KB);
    // Only the FIRST attempt was ever measured — no wasted lower-quality tries once one already fits.
    expect(seen).toEqual([{ sizePx: 512, quality: 0.85 }]);
  });

  it("quality alone is not trusted — a noisy image that barely shrinks with quality still gets measured at every step, and the downscale ladder is what actually rescues it", async () => {
    // DESIGN_PRODUCTS.md §5's pathological case, reproduced as a fabricated
    // measurement table: at 512px, q85->q35 all land in the 60-71 KB range
    // (real measured: q70 71KB, q60 70.9KB — quality barely moves the
    // needle on incompressible sensor noise). Only downscaling helps —
    // real measured: 320px/q60 -> 22.8 KB, comfortably under the 32 KB
    // budget.
    const bytesFor: Record<string, number> = {
      "512:0.85": 78 * KB,
      "512:0.75": 74 * KB,
      "512:0.65": 71 * KB,
      "512:0.55": 71 * KB, // barely moves — the whole point (1% saved q80->q50 per the design doc)
      "512:0.45": 70.9 * KB,
      "512:0.35": 70.5 * KB,
      "448:0.6": 48 * KB,
      "384:0.6": 34 * KB,
      "320:0.6": 22.8 * KB, // finally fits
    };
    const seen: EncodeAttempt[] = [];
    const result = await pickUnderBudget(async (attempt) => {
      seen.push(attempt);
      const key = `${attempt.sizePx}:${attempt.quality}`;
      const bytes = bytesFor[key];
      if (bytes === undefined) throw new Error(`no fabricated measurement for ${key}`);
      return { bytes, result: key };
    });

    expect(result.withinBudget).toBe(true);
    expect(result.attempt).toEqual({ sizePx: 320, quality: 0.6 });
    expect(result.bytes).toBeCloseTo(22.8 * KB);
    // EVERY attempt in the ladder was measured, in order, before landing on
    // the one that fit — this is "enforced by measurement", not a shortcut
    // that guesses q60 will do or stops after the quality ladder alone.
    expect(seen).toEqual(encodeAttempts());
  });

  it("if even the smallest/lowest-quality attempt is still over budget, returns it anyway with withinBudget: false (best effort — the hard refusal is the codec's job, not this function's)", async () => {
    const result = await pickUnderBudget(async () => ({ bytes: 500 * KB, result: "still-huge" }));
    expect(result.withinBudget).toBe(false);
    expect(result.attempt).toEqual({ sizePx: 320, quality: 0.6 }); // the last attempt in the ladder
    expect(result.bytes).toBe(500 * KB);
  });

  it("respects a custom budget/attempt list (used by tests that don't want the full 9-step ladder)", async () => {
    const attempts: EncodeAttempt[] = [
      { sizePx: 100, quality: 0.9 },
      { sizePx: 100, quality: 0.5 },
    ];
    const result = await pickUnderBudget(
      async (attempt) => ({ bytes: attempt.quality > 0.5 ? 200 : 50, result: attempt }),
      100,
      attempts,
    );
    expect(result.attempt).toEqual({ sizePx: 100, quality: 0.5 });
    expect(result.withinBudget).toBe(true);
  });
});
