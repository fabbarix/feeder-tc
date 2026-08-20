/**
 * Deterministic Rng fake (design requirement 6). Thin wrapper over the real
 * seeded PRNG (src/domain/rng.ts) — determinism comes from the seed, not a
 * separate algorithm, so tests get the exact reproducibility WP-13's
 * generator needs (1000 seeded weeks, same seed ⇒ same week every run).
 */
import { createSeededRng } from "../rng.ts";
import type { Rng } from "../contracts.ts";

export function createFakeRng(seed = 42): Rng {
  return createSeededRng(seed);
}
