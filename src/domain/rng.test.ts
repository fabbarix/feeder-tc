import { describe, expect, it } from "vitest";
import { createSeededRng } from "./rng.ts";

describe("createSeededRng", () => {
  it("is deterministic: the same seed always produces the same sequence", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const sequenceA = Array.from({ length: 10 }, () => a.next());
    const sequenceB = Array.from({ length: 10 }, () => b.next());
    expect(sequenceA).toEqual(sequenceB);
  });

  it("different seeds produce different sequences", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const sequenceA = Array.from({ length: 5 }, () => a.next());
    const sequenceB = Array.from({ length: 5 }, () => b.next());
    expect(sequenceA).not.toEqual(sequenceB);
  });

  it("always returns a value in [0, 1)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
