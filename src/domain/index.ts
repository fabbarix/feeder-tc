// Pure domain layer: entity types, contracts, and engines (inventory fold/FIFO,
// planner generator, shopping allocator). No I/O, no React, no globals — Clock
// and Rng are always injected. See IMPLEMENTATION_PLAN.md WP-02/12/13/14.
//
// This barrel re-exports the frozen contracts (types.ts, contracts.ts) plus
// the small set of pure helpers built on them. It deliberately does NOT
// re-export src/domain/fakes — import those from "./fakes/index.ts"
// (or "src/domain/fakes") explicitly, so production code can never
// accidentally pull in a test double via this barrel.
export * from "./types.ts";
export * from "./contracts.ts";
export * from "./dates.ts";
export * from "./quantity.ts";
export * from "./ids.ts";
export { systemClock } from "./clock.ts";
export { createSeededRng } from "./rng.ts";
export * from "./planner/index.ts";
