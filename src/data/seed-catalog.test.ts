import { describe, expect, it } from "vitest";
import type { Ingredient, StorageLocation, Unit } from "../domain/index.ts";
import {
  LEFTOVER_DEFAULT_LOCATION,
  LEFTOVER_FREEZER_SHELF_LIFE_DAYS,
  LEFTOVER_FRIDGE_SHELF_LIFE_DAYS,
  LEFTOVER_UNIT,
  seedCatalog,
} from "./seed-catalog.ts";

const ALLOWED_UNITS: readonly Unit[] = ["g", "ml", "piece", "portion"];
const ALLOWED_LOCATIONS: readonly StorageLocation[] = ["pantry", "fridge", "freezer"];

describe("seedCatalog", () => {
  it("has roughly 100 entries", () => {
    // "~100 common ingredients" per IMPLEMENTATION_PLAN.md WP-16 — not an
    // exact contract, but a regression that dropped or bulk-duplicated
    // entries should fail this.
    expect(seedCatalog.length).toBeGreaterThanOrEqual(95);
    expect(seedCatalog.length).toBeLessThanOrEqual(120);
  });

  it("has no duplicate ids", () => {
    const ids = seedCatalog.map((i) => i.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("has no duplicate names", () => {
    const names = seedCatalog.map((i) => i.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("has no duplicate names case-insensitively", () => {
    const names = seedCatalog.map((i) => i.name.toLowerCase());
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("gives every entry a non-empty, human-readable slug id (invariant 6)", () => {
    for (const ingredient of seedCatalog) {
      expect(ingredient.id.length).toBeGreaterThan(0);
      // Slug-shaped: lowercase letters, digits, hyphens only — never a UUID
      // or other opaque token (see this WP's id-strategy note).
      expect(ingredient.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("gives every entry a unit in the allowed set", () => {
    for (const ingredient of seedCatalog) {
      expect(ALLOWED_UNITS).toContain(ingredient.unit);
    }
  });

  it("gives every entry a default location in the allowed set", () => {
    for (const ingredient of seedCatalog) {
      expect(ALLOWED_LOCATIONS).toContain(ingredient.defaultLocation);
    }
  });

  it("gives every entry positive, finite shelf life values", () => {
    for (const ingredient of seedCatalog) {
      expect(ingredient.shelfLifeDays).toBeGreaterThan(0);
      expect(Number.isFinite(ingredient.shelfLifeDays)).toBe(true);
      expect(ingredient.openedShelfLifeDays).toBeGreaterThan(0);
      expect(Number.isFinite(ingredient.openedShelfLifeDays)).toBe(true);
    }
  });

  it("never lets opened shelf life exceed unopened shelf life", () => {
    for (const ingredient of seedCatalog) {
      expect(ingredient.openedShelfLifeDays).toBeLessThanOrEqual(ingredient.shelfLifeDays);
    }
  });

  it("every entry is constructible as a valid Ingredient", () => {
    for (const ingredient of seedCatalog) {
      const asIngredient: Ingredient = ingredient;
      expect(asIngredient.id).toBeTruthy();
      expect(asIngredient.name).toBeTruthy();
      expect(ALLOWED_UNITS).toContain(asIngredient.unit);
      expect(ALLOWED_LOCATIONS).toContain(asIngredient.defaultLocation);
    }
  });

  it("covers every household category this WP's brief calls out", () => {
    // Spot-check one representative id per category rather than asserting on
    // the comment groupings in seed-catalog.ts (which aren't part of the
    // runtime shape).
    const ids = new Set<string>(seedCatalog.map((i) => String(i.id)));
    const representative = [
      "tomato", // produce
      "milk", // dairy
      "chicken-breast", // meat/fish
      "rice", // dry goods
      "tinned-tomatoes", // tinned/jarred
      "frozen-peas", // frozen
      "olive-oil", // condiments
      "flour", // baking
      "black-pepper", // herbs/spices
      "coffee", // drinks
    ];
    for (const id of representative) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("gives a tomato both a pantry default and a shorter opened shelf life once cut (matches WP-12's BDD fixture)", () => {
    const tomato = seedCatalog.find((i) => i.id === "tomato");
    expect(tomato).toBeDefined();
    expect(tomato?.unit).toBe("piece");
    expect(tomato?.shelfLifeDays).toBe(7);
    expect(tomato?.openedShelfLifeDays).toBe(2);
  });
});

describe("leftover pseudo-ingredient defaults", () => {
  it("uses the portion unit", () => {
    expect(LEFTOVER_UNIT).toBe("portion");
  });

  it("defaults to the fridge", () => {
    expect(LEFTOVER_DEFAULT_LOCATION).toBe("fridge");
  });

  it("gives a short fridge shelf life, shorter than the freezer one", () => {
    expect(LEFTOVER_FRIDGE_SHELF_LIFE_DAYS).toBeGreaterThan(0);
    expect(LEFTOVER_FREEZER_SHELF_LIFE_DAYS).toBeGreaterThan(LEFTOVER_FRIDGE_SHELF_LIFE_DAYS);
  });
});
