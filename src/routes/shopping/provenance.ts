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
import {
  formatQuantity,
  isIndivisible,
  scaleIndivisible,
  suggestPurchase,
  type Ingredient,
  type IngredientId,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type Settings,
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
 * and what's already in the pantry won't still be good by those dates." —
 * one clause per source, in the engine's own (date-then-slot) order, ending
 * in the fixed closing clause the mock uses verbatim in spirit (DESIGN.md's
 * viable-stock rule: "a lot counts only if its expiry is on/after the
 * planned cook date" — "lot" being warehouse vocabulary the household
 * never needs, per the sibling `buildRoundingExplanation`'s own
 * plain-language model just below, e.g. "sold in 250 g jars").
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
  return `${clauses.join(", ")}, and what's already in the pantry won't still be good by those dates.`;
}

/**
 * WP-PURCHASING (DESIGN_PURCHASING.md §6 mock: "Store lasagna — serves 4,
 * you need 2") — the row subtitle for a line backed by an indivisible
 * recipe. Takes priority over both plain provenance and the generic "needs
 * X" text, because the household-relevant fact for a bought meal is the
 * SERVINGS gap, not the (already-whole, already-equal-to-the-buy) unit
 * count. `undefined` for any other line, so the caller's existing fallback
 * chain (rounded/adjusted "needs X", else provenance) is untouched.
 */
export function buildIndivisibleSecondary(line: ShoppingListLine, ctx: ProvenanceContext): string | undefined {
  const source = line.sources[0];
  const recipe = source ? ctx.recipes.find((r) => r.id === source.recipeId) : undefined;
  if (!source || !recipe || !isIndivisible(recipe)) return undefined;
  const slot = ctx.planSlots.find((s) => s.id === source.planSlotId);
  const scaleServings = slot && slot.filling.kind === "recipe" ? slot.filling.scaleServings : undefined;
  const targetServings = scaleServings ?? ctx.settings.householdSize;
  return `serves ${recipe.baseServings}, you need ${formatAmount(targetServings)}`;
}

/**
 * WP-PURCHASING (DESIGN_PURCHASING.md §6): the extra sentence the "Why?"
 * disclosure gains, explaining the rounding itself — *"3 meals need 130 g;
 * sold in 250 g jars."* An explicit household override never needs
 * defending (§6: "it needs the small 'adjusted' label..., not a Why?"), so
 * this returns `undefined` for an overridden line. It also returns
 * `undefined` when the buy amount already equals the need (nothing to
 * explain) UNLESS the line is backed by an indivisible recipe with a
 * forecast surplus (§4 scenario 1/2), in which case it explains the
 * servings/leftover math instead of pack rounding — the two scenarios never
 * both apply to the same line (an indivisible recipe's ingredient line is
 * already whole by the time it reaches `neededQuantity`, so pack-rounding on
 * top of it is a no-op — see `shopping-needs.ts`'s `scaleFactor`).
 */
export function buildRoundingExplanation(
  line: ShoppingListLine,
  ingredient: Ingredient,
  ctx: ProvenanceContext,
): string | undefined {
  if (line.purchaseOverride !== undefined) return undefined;

  const source = line.sources[0];
  const recipe = source ? ctx.recipes.find((r) => r.id === source.recipeId) : undefined;
  if (source && recipe && isIndivisible(recipe)) {
    const slot = ctx.planSlots.find((s) => s.id === source.planSlotId);
    const scaleServings = slot && slot.filling.kind === "recipe" ? slot.filling.scaleServings : undefined;
    const targetServings = scaleServings ?? ctx.settings.householdSize;
    const scaling = scaleIndivisible(recipe, targetServings);
    if (scaling.surplusServings > 0) {
      const label = sourceLabel(source, "long");
      const unitWord = scaling.units === 1 ? "" : `${scaling.units} `;
      const servingWord = scaling.surplusServings === 1 ? "serving" : "servings";
      return (
        `${label} needs ${formatAmount(targetServings)} servings. ${recipe.name} can't be split — it's bought as ` +
        `a whole ${recipe.baseServings}-serving pack, so ${unitWord || "1 "}covers it with ` +
        `${formatAmount(scaling.surplusServings)} ${servingWord} forecast as a leftover.`
      );
    }
  }

  const suggestion = suggestPurchase(line.neededQuantity, ingredient);
  if (suggestion.quantity.amount === line.neededQuantity.amount) return undefined;

  if (suggestion.mode === "whole" && suggestion.packSize && suggestion.units !== undefined) {
    return (
      `Needs ${formatQuantity(line.neededQuantity)}; sold in ${formatQuantity(suggestion.packSize)} packs, so we ` +
      `round up to ${suggestion.units} — ${formatQuantity(suggestion.surplus)} becomes pantry surplus, not waste.`
    );
  }
  return (
    `Needs ${formatQuantity(line.neededQuantity)}; rounded up to ${formatQuantity(suggestion.quantity)} — ` +
    `${formatQuantity(suggestion.surplus)} becomes pantry surplus.`
  );
}
