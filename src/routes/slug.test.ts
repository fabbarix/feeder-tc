import { describe, expect, it } from "vitest";
import { createSeededRng } from "../domain/index.ts";
import { slugify, uniqueSlug } from "./slug.ts";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Store Lasagna")).toBe("store-lasagna");
  });

  it("strips diacritics", () => {
    expect(slugify("Crème brûlée")).toBe("creme-brulee");
  });

  it("falls back to 'item' for a name with no alphanumeric characters", () => {
    expect(slugify("!!!")).toBe("item");
  });
});

describe("uniqueSlug", () => {
  it("returns the plain slug when it doesn't collide", () => {
    const rng = createSeededRng(1);
    expect(uniqueSlug("Store Lasagna", new Set(), rng)).toBe("store-lasagna");
  });

  it("appends a random suffix on collision, and keeps it unique", () => {
    const rng = createSeededRng(1);
    const slug = uniqueSlug("Store Lasagna", new Set(["store-lasagna"]), rng);
    expect(slug).toMatch(/^store-lasagna-[0-9a-z]{4}$/);
  });
});
