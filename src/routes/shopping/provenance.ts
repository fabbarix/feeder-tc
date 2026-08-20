/**
 * Turns `ShoppingListLine.sources` (WP-14) into the two pieces of copy the
 * mock shows and the previous Shopping.tsx stub discarded entirely:
 *
 *  - the per-row subtitle ("Mon dinner · Thu lunch" / "Monday dinner ·
 *    Thursday lunch") — every screen size, from `CheckRow`'s `secondary`.
 *  - the desktop rail's "Why 5 tomatoes?" sentence — UI_DESIGN.md §13
 *    "Desktop": "width buys information, not padding".
 *
 * `ShoppingNeedSource` (shopping-types.ts, WP-14, not touched here) carries
 * which meal contributed to a shortfall but not how much of it that meal
 * needed — the allocator only tracks the running shortfall total, not a
 * per-source remainder (see shopping-allocate.ts). `sourceAmount` below
 * recovers the best available number — the meal's own scaled requirement
 * for this ingredient, via the exact same scaling formula
 * `computeNeeds` uses — which is what DESIGN.md's own example sentence
 * ("Monday dinner needs 2") is describing. This is a display-only
 * derivation from already-fetched data (recipe/plan-slot lookups), not a
 * re-implementation of FIFO allocation, so it stays presentation logic, not
 * a shadow copy of the engine.
 */
import type {
  IngredientId,
  PlanSlot,
  Recipe,
  RecipeIngredient,
  Settings,
} from "../../domain/index.ts";
import type { ShoppingListLine, ShoppingNeedSource } from "../../domain/index.ts";
import { weekdayLabel } from "./range.ts";

export interface ProvenanceContext {
  readonly planSlots: readonly PlanSlot[];
  readonly recipes: readonly Recipe[];
  readonly recipeIngredients: readonly RecipeIngredient[];
  readonly settings: Settings;
}

/** Trims to at most 2 decimals without a trailing ".00"/".50" — "2", "1.5", never "2.00". */
function formatAmount(amount: number): string {
  return Number(amount.toFixed(2)).toString();
}

/**
 * The scaled quantity of `ingredientId` that `source`'s meal needed, using
 * the same servings-scaling rule `computeNeeds` uses (per-slot
 * `scaleServings` override, else `settings.householdSize`, over the
 * recipe's `baseServings`). `undefined` if any referenced row can't be
 * found — a data-integrity edge case, not something to throw on in a
 * display formatter.
 */
export function sourceAmount(
  source: ShoppingNeedSource,
  ingredientId: IngredientId,
  ctx: ProvenanceContext,
): number | undefined {
  const slot = ctx.planSlots.find((s) => s.id === source.planSlotId);
  const recipe = ctx.recipes.find((r) => r.id === source.recipeId);
  const line = ctx.recipeIngredients.find(
    (l) => l.recipeId === source.recipeId && l.ingredientId === ingredientId,
  );
  if (!recipe || !line || recipe.baseServings <= 0) return undefined;
  const scaleServings =
    slot && slot.filling.kind === "recipe" ? slot.filling.scaleServings : undefined;
  const target = scaleServings ?? ctx.settings.householdSize;
  return line.quantity.amount * (target / recipe.baseServings);
}

/** "Mon dinner" / "Monday dinner" — one source, no amount (that's the rail's job, not every row's subtitle). */
function sourceLabel(source: ShoppingNeedSource, style: "short" | "long"): string {
  return `${weekdayLabel(source.date, style)} ${source.slotType}`;
}

/** "Mon dinner · Thu lunch" (CheckRow's `secondary`, both breakpoints — the style differs, not the presence). */
export function buildProvenanceText(
  sources: readonly ShoppingNeedSource[],
  style: "short" | "long" = "short",
): string {
  return sources.map((s) => sourceLabel(s, style)).join(" · ");
}

/**
 * The desktop rail's explanation sentence (UI_DESIGN.md §13 / the mock's
 * "Why 5 tomatoes?" card): "Monday dinner needs 2, Thursday lunch needs 3,
 * and no viable lot expires on or after those dates." — one clause per
 * source, in the engine's own (date-then-slot) order, ending in the fixed
 * closing clause the mock uses verbatim (DESIGN.md's viable-stock rule:
 * "a lot counts only if its expiry is on/after the planned cook date").
 */
export function buildWhyExplanation(
  line: ShoppingListLine,
  ctx: ProvenanceContext,
): string {
  const clauses = line.sources.map((source) => {
    const amount = sourceAmount(source, line.ingredientId, ctx);
    const label = sourceLabel(source, "long");
    return amount === undefined ? label : `${label} needs ${formatAmount(amount)}`;
  });
  return `${clauses.join(", ")}, and no viable lot expires on or after those dates.`;
}
