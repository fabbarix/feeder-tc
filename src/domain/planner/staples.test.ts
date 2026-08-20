import { describe, expect, it } from "vitest";
import { makeRecipeId, type RecipeId } from "../types.ts";
import { advanceStaples, initialStapleRotationState } from "./staples.ts";

function ids(...raw: string[]): RecipeId[] {
  return raw.map((r) => makeRecipeId(r));
}

describe("advanceStaples", () => {
  it("places every staple once when slots >= staples", () => {
    const staples = ids("s1", "s2");
    const batch = advanceStaples(staples, initialStapleRotationState, 7);
    expect([...batch.placed].sort()).toEqual([...staples].sort());
  });

  it("round-robins across weeks when staples > slots: every staple appears at least once across two weeks", () => {
    const staples = ids("s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9");
    const week1 = advanceStaples(staples, initialStapleRotationState, 7);
    const week2 = advanceStaples(staples, week1.nextState, 7);

    const seenAcrossTwoWeeks = new Set([...week1.placed, ...week2.placed]);
    expect(seenAcrossTwoWeeks.size).toBe(9);
    for (const id of staples) {
      expect(seenAcrossTwoWeeks.has(id)).toBe(true);
    }
  });

  it("no staple appears twice before all have appeared once (within one cycle)", () => {
    const staples = ids("s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9");
    const week1 = advanceStaples(staples, initialStapleRotationState, 7);
    const week2 = advanceStaples(staples, week1.nextState, 7);

    // week1 placed 7 distinct staples; week2 must not repeat any of those
    // until the remaining 2 (and only those 2) have appeared.
    const week1Set = new Set(week1.placed);
    for (const id of week2.placed) {
      expect(week1Set.has(id)).toBe(false);
    }
    expect(week1.placed).toHaveLength(7);
    expect(week2.placed).toHaveLength(2);
  });

  it("a call never repeats a staple to pad out extra slots — the cycle only refills at the start of a call", () => {
    // 3 staples, 2 slots/week: a week is never "topped up" by wrapping into
    // the next cycle mid-call (that would place a staple twice before the
    // whole set had appeared once, i.e. within the very cycle it's meant to
    // protect). The leftover staple carries over as a shorter placement.
    const staples = ids("s1", "s2", "s3");
    const week1 = advanceStaples(staples, initialStapleRotationState, 2);
    expect(week1.placed).toEqual(ids("s1", "s2"));

    const week2 = advanceStaples(staples, week1.nextState, 2);
    expect(week2.placed).toEqual(ids("s3")); // only 1 left in the cycle, not padded to 2

    // The cycle is now fully drained; week3 starts a fresh one from scratch.
    const week3 = advanceStaples(staples, week2.nextState, 2);
    expect(week3.placed).toEqual(ids("s1", "s2"));
  });

  it("fewer slots than staples places only as many as there are slots", () => {
    const staples = ids("s1", "s2", "s3");
    const batch = advanceStaples(staples, initialStapleRotationState, 1);
    expect(batch.placed).toHaveLength(1);
    expect(batch.nextState.queue).toHaveLength(2);
  });

  it("zero slots places nothing but still tracks membership", () => {
    const staples = ids("s1", "s2");
    const batch = advanceStaples(staples, initialStapleRotationState, 0);
    expect(batch.placed).toHaveLength(0);
  });

  it("a staple removed from rotation mid-cycle is dropped from the queue", () => {
    const week1 = advanceStaples(ids("s1", "s2", "s3"), initialStapleRotationState, 1);
    expect(week1.placed).toEqual(ids("s1"));
    // s3 is retired before week 2's generation.
    const week2 = advanceStaples(ids("s1", "s2"), week1.nextState, 2);
    expect(week2.placed).toEqual(ids("s2"));
  });

  it("a staple added mid-cycle gets a turn without waiting for a full reset", () => {
    const week1 = advanceStaples(ids("s1", "s2"), initialStapleRotationState, 1);
    expect(week1.placed).toEqual(ids("s1"));
    // s3 becomes a staple before week 2.
    const week2 = advanceStaples(ids("s1", "s2", "s3"), week1.nextState, 2);
    expect([...week2.placed].sort()).toEqual(ids("s2", "s3").sort());
  });

  it("is a pure function: same inputs always produce the same outputs", () => {
    const staples = ids("s1", "s2", "s3");
    const a = advanceStaples(staples, initialStapleRotationState, 2);
    const b = advanceStaples(staples, initialStapleRotationState, 2);
    expect(a).toEqual(b);
  });
});
