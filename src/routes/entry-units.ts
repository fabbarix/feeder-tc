/**
 * Recipe-ingredient entry units (WP-purchasing-editor —
 * DESIGN_PURCHASING.md §10). Distinct from `scan/scan-options.ts`'s
 * `entryUnitsFor`, which is keyed on canonical `Unit` alone (right for the
 * product editor, where nothing else about the ingredient is asked): a
 * recipe line needs to know THIS ingredient's own density/piece-weight
 * constants, because that's exactly what decides whether a cross-dimension
 * unit (cup/tbsp/tsp into a mass ingredient, `piece` into a mass ingredient)
 * is safe to offer at all (§10.1 — "never silently guess a density").
 *
 * This is a route-level module (`src/routes/**`), so it may import
 * `src/domain/units.ts` directly — the same invariant-3 exception
 * `IngredientEditor.tsx`/`RecipeEditor.tsx`/`ProductEditorPanel.tsx` already
 * use, entry-time-only, never re-implementing conversion itself.
 */
import { convertEntryToCanonical } from "../domain/units.ts";
import type { EntryUnit, Ingredient } from "../domain/index.ts";

const MASS_UNITS: readonly EntryUnit[] = ["kg", "g", "lb", "oz"];
const VOLUME_UNITS: readonly EntryUnit[] = ["l", "ml", "fl oz", "cup", "tbsp", "tsp"];

export const ENTRY_UNIT_LABELS: Record<EntryUnit, string> = {
  kg: "kg",
  g: "g",
  lb: "lb",
  oz: "oz",
  l: "l",
  ml: "ml",
  "fl oz": "fl oz",
  piece: "piece",
  cup: "cup",
  tbsp: "tbsp",
  tsp: "tsp",
};

/**
 * Which `EntryUnit`s a recipe author may type this specific ingredient's
 * amount in. Mass<->mass and volume<->volume are always free — universal
 * constants, `units.ts`'s own table (§10.1's "no" column) — so those are
 * offered regardless of this ingredient's own data. Crossing dimension
 * (volume/count into a mass-canonical ingredient) is offered only when the
 * matching constant (`gramsPerMl`/`gramsPerPiece`) is actually set — never
 * guessed, per §10.1's own rule, restated at the entry-time layer this
 * package adds a UI for.
 */
export function recipeEntryUnitsFor(ingredient: Ingredient): readonly EntryUnit[] {
  switch (ingredient.unit) {
    case "g":
      return [
        ...MASS_UNITS,
        ...(ingredient.gramsPerMl !== undefined ? VOLUME_UNITS : []),
        ...(ingredient.gramsPerPiece !== undefined ? (["piece"] as const) : []),
      ];
    case "ml":
      // Entering a mass unit against a volume-canonical ingredient has no
      // engine support at all (`units.ts`'s `convertEntryToCanonical` only
      // ever converts INTO a mass canonical unit) — never offered.
      return VOLUME_UNITS;
    case "piece":
      return ["piece"];
    case "portion":
      // Leftover-lot-only unit, never a recipe ingredient's own canonical
      // unit in practice — no entry-time equivalent (units.ts's own rule).
      return [];
  }
}

/**
 * The grams-equivalent shown alongside what was typed (§10.5 — "1 cup flour
 * (130 g)"), purely informational: `undefined` whenever there's nothing new
 * to say (the typed unit already IS grams) or nothing computable (no
 * density/piece-weight set). Never the value actually stored — that's
 * `quantity`, computed once at save time the same way.
 */
export function gramsPreview(amount: number, entryUnit: EntryUnit, ingredient: Ingredient): number | undefined {
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  if (ingredient.unit === "g") {
    if (entryUnit === "g") return undefined;
    try {
      return convertEntryToCanonical({ amount, unit: entryUnit }, "g", {
        ...(ingredient.gramsPerMl !== undefined ? { gramsPerMl: ingredient.gramsPerMl } : {}),
        ...(ingredient.gramsPerPiece !== undefined ? { gramsPerPiece: ingredient.gramsPerPiece } : {}),
      }).amount;
    } catch {
      return undefined;
    }
  }
  if (ingredient.unit === "piece" && entryUnit === "piece" && ingredient.gramsPerPiece !== undefined) {
    return amount * ingredient.gramsPerPiece;
  }
  return undefined;
}
