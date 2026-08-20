/**
 * The real Clock implementation. This is the one place in `src/domain` that
 * is allowed to touch the wall clock — every pure engine takes a `Clock`
 * injected instead of calling `Date.now()`/`new Date()` itself (design
 * requirement 6). `src/domain/fakes/clock.ts` provides the deterministic
 * counterpart for tests.
 */
import type { Clock } from "./contracts.ts";
import { makeIsoDate, makeIsoTimestamp, type IsoDate, type IsoTimestamp } from "./types.ts";

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

/** Real Clock: reads the system wall clock. */
export const systemClock: Clock = {
  now(): IsoTimestamp {
    return makeIsoTimestamp(new Date().toISOString());
  },
  today(): IsoDate {
    const d = new Date();
    return makeIsoDate(
      `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`,
    );
  },
};
