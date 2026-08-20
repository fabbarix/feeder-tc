/**
 * Deterministic Clock fake (design requirement 6). Wall-clock time never
 * changes on its own — tests set it explicitly and, when a scenario needs
 * time to pass, advance it explicitly.
 */
import type { Clock } from "../contracts.ts";
import type { IsoDate, IsoTimestamp } from "../types.ts";

export interface ManualClock extends Clock {
  set(next: { now?: IsoTimestamp; today?: IsoDate }): void;
}

export function createManualClock(initial: { now: IsoTimestamp; today: IsoDate }): ManualClock {
  let state: { now: IsoTimestamp; today: IsoDate } = { ...initial };
  return {
    now(): IsoTimestamp {
      return state.now;
    },
    today(): IsoDate {
      return state.today;
    },
    set(next): void {
      if (next.now !== undefined) {
        state = { ...state, now: next.now };
      }
      if (next.today !== undefined) {
        state = { ...state, today: next.today };
      }
    },
  };
}

/** A clock permanently fixed at one instant — the common case in engine unit tests. */
export function createFixedClock(now: IsoTimestamp, today: IsoDate): Clock {
  return createManualClock({ now, today });
}
