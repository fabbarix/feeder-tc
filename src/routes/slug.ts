/**
 * Human-readable id slugs for catalog entries created from the UI (recipes
 * naming their own bought-meal product ingredient, or a household member
 * adding a new catalog ingredient by hand) — matching seed-catalog.ts's own
 * id strategy so the `Ingredients` sheet stays readable end to end
 * (invariant 6), not a mix of hand-written slugs and opaque random ids.
 */
import { randomIdString, type Rng } from "../domain/index.ts";

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base === "" ? "item" : base;
}

/** Appends a short random suffix only if the plain slug already collides with an existing id. */
export function uniqueSlug(name: string, existingIds: ReadonlySet<string>, rng: Rng): string {
  const base = slugify(name);
  if (!existingIds.has(base)) return base;
  let candidate = `${base}-${randomIdString(rng, 4)}`;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${randomIdString(rng, 4)}`;
  }
  return candidate;
}
