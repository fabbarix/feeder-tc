/**
 * The real Rng implementation: a small seeded PRNG (mulberry32). This is the
 * one place in `src/domain` allowed to be "the" source of randomness — every
 * engine takes an `Rng` injected instead of calling `Math.random()` itself
 * (design requirement 6).
 *
 * The same algorithm serves both roles the design asks for: seeded with a
 * fixed number it is the deterministic, reproducible Rng WP-13's generator
 * tests need (1000 seeded weeks); seeded from real entropy at app start (by
 * the UI/sync layer, outside `src/domain`) it is the production Rng. There is
 * no need for two different algorithms — determinism is a property of being
 * given the same seed, not of the algorithm itself.
 */
import type { Rng } from "./contracts.ts";

/** Creates a seeded, deterministic Rng. Same seed ⇒ same sequence, always. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
