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

  it("gives a tomato a pantry default and a shorter opened shelf life once cut, now re-united to grams (WP-PURCHASING §9.1/§11.2)", () => {
    const tomato = seedCatalog.find((i) => i.id === "tomato");
    expect(tomato).toBeDefined();
    // §9.1: the owner-decided re-unit — a recipe now reads "400 g tomatoes";
    // shelf life values are unchanged by the re-unit.
    expect(tomato?.unit).toBe("g");
    expect(tomato?.shelfLifeDays).toBe(7);
    expect(tomato?.openedShelfLifeDays).toBe(2);
    // gramsPerPiece lets "2 tomatoes" still convert to grams at entry time.
    expect(tomato?.gramsPerPiece).toBeGreaterThan(0);
  });
});

describe("seedCatalog — purchasability (WP-PURCHASING §3/§11.2)", () => {
  it("Onion and Bell pepper STAY piece — the §11.2 correction, and §5's own worked example depends on it", () => {
    const onion = seedCatalog.find((i) => i.id === "onion");
    const bellPepper = seedCatalog.find((i) => i.id === "bell-pepper");
    expect(onion?.unit).toBe("piece");
    expect(bellPepper?.unit).toBe("piece");
  });

  it("re-units every §11.2 jar/tin item to g/ml with a whole purchaseMode and a positive packSize in its own unit", () => {
    const reUnited = [
      "tinned-tomatoes",
      "tinned-chickpeas",
      "tinned-black-beans",
      "tinned-tuna",
      "tinned-corn",
      "tomato-passata",
      "pasta-sauce",
      "peanut-butter",
      "jam",
      "honey",
      "olives",
      "pickles",
    ];
    for (const id of reUnited) {
      const ingredient = seedCatalog.find((i) => i.id === id);
      expect(ingredient, `expected seed ingredient "${id}" to exist`).toBeDefined();
      expect(["g", "ml"]).toContain(ingredient?.unit);
      expect(ingredient?.purchaseMode).toBe("whole");
      expect(ingredient?.packSize?.amount).toBeGreaterThan(0);
      expect(ingredient?.packSize?.unit).toBe(ingredient?.unit);
    }
  });

  it("gives flour a density so cup/tbsp/tsp entry is offered (§10.1a's own worked example: 1 cup flour = 130 g)", () => {
    const flour = seedCatalog.find((i) => i.id === "flour");
    expect(flour?.gramsPerMl).toBeCloseTo(130 / 240, 3);
  });

  it("never sets gramsPerMl/gramsPerPiece/roundTo to a non-positive value", () => {
    for (const ingredient of seedCatalog) {
      if (ingredient.gramsPerMl !== undefined) expect(ingredient.gramsPerMl).toBeGreaterThan(0);
      if (ingredient.gramsPerPiece !== undefined) expect(ingredient.gramsPerPiece).toBeGreaterThan(0);
      if (ingredient.roundTo !== undefined) expect(ingredient.roundTo).toBeGreaterThan(0);
    }
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
