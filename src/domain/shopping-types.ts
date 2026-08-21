/**
 * Shopping engine value types — WP-14.
 *
 * These are computed/API types, not persisted schema (that's `ShoppingItem`
 * in `types.ts`, which this module deliberately does not touch — `types.ts`
 * is frozen). `ShoppingItem` is the *persisted row* shape (keyed per date
 * range, carries `checked`/`boughtQuantity` state owned by the sync layer);
 * `ShoppingListLine` below is the *computed* shape this engine returns, rich
 * enough to build a `ShoppingItem` from but carrying provenance a persisted
 * row has no room for.
 *
 * Zero side effects, zero imports beyond `./types.ts` (type-only, per
 * verbatimModuleSyntax).
 */
import type {
  IngredientId,
  IsoDate,
  MealTag,
  PlanSlotId,
  Quantity,
  RecipeId,
  StorageLocation,
} from "./types.ts";

/** Inclusive calendar-day range a shopping list is computed over (a week or several). */
export interface DateRange {
  readonly start: IsoDate;
  readonly end: IsoDate;
}

/** Identifies the single planned meal that produced one `ShoppingNeed`. */
export interface ShoppingNeedSource {
  readonly planSlotId: PlanSlotId;
  readonly date: IsoDate;
  readonly slotType: MealTag;
  readonly slotIndex: number;
  readonly recipeId: RecipeId;
}

/**
 * One ingredient's scaled requirement for one planned meal. `computeNeeds`
 * emits one of these per (PlanSlot, RecipeIngredient) pair — aggregation
 * across meals happens later, in `allocateShoppingList`, because FIFO
 * allocation needs to see needs one meal at a time, in cook-date order, not
 * pre-summed.
 */
export interface ShoppingNeed {
  readonly ingredientId: IngredientId;
  readonly quantity: Quantity;
  readonly source: ShoppingNeedSource;
}

/**
 * One grouped, post-allocation shopping-list line: the remaining amount to
 * buy for one ingredient over the range, after viable stock has been FIFO-
 * subtracted, with per-meal provenance for the "which meals need this"
 * tooltip (IMPLEMENTATION_PLAN.md WP-14 notes). Ingredients fully covered by
 * viable stock produce no line at all (see `allocateShoppingList`).
 */
export interface ShoppingListLine {
  readonly ingredientId: IngredientId;
  readonly rangeStart: IsoDate;
  readonly rangeEnd: IsoDate;
  /** Remaining quantity to buy, in the ingredient's one canonical unit. */
  readonly neededQuantity: Quantity;
  /**
   * Meals whose need was not (fully) covered by viable stock, contributing
   * to `neededQuantity`. A meal whose need was fully covered by stock is
   * omitted — see the "Viable stock reduces the list FIFO by cook date" BDD
   * scenario, where Tuesday's fully-covered need drops out and only
   * Friday's remainder is attributed.
   */
  readonly sources: readonly ShoppingNeedSource[];
  /**
   * WP-PURCHASING (DESIGN_PURCHASING.md §2.1/§7), additive. The purchasable
   * amount `allocateShoppingList` suggests for `neededQuantity`, computed
   * exactly once — on this already-aggregated, post-FIFO shortfall, never
   * per-meal and never before stock subtraction (§2.1 is explicit this is
   * the easiest step to get wrong). `undefined` only if the caller didn't
   * supply a catalog for the ingredient (defensive — every real caller
   * does), in which case the UI should fall back to `neededQuantity`.
   */
  readonly suggestedPurchase?: Quantity;
  /**
   * The household's explicit buy-amount choice for this ingredient+range,
   * if one exists in persisted `ShoppingItem.purchaseOverride` — merged in
   * by the caller (`src/domain/purchasing.ts`'s `withPurchaseOverride`),
   * not computed by `allocateShoppingList` itself (the engine has no I/O
   * and cannot see persisted rows). Wins over `suggestedPurchase` for
   * display and for what a check-off pre-fills.
   */
  readonly purchaseOverride?: Quantity;
}

/**
 * Input to `checkOffShoppingItem`. `neededQuantity` is the default actual
 * quantity (DESIGN.md §2 "pre-filled with the needed amount"); `actualQuantity`
 * is the user's override for package sizes ("needed 400g, bought 1kg").
 * `location` is not carried by `ShoppingListLine` — it comes from the
 * ingredient catalog's `defaultLocation` (editable by the user at check-off
 * time), which is the caller's (WP-23) job to supply, keeping this engine
 * free of a catalog-lookup dependency it doesn't otherwise need.
 */
export interface CheckOffInput {
  readonly ingredientId: IngredientId;
  readonly neededQuantity: Quantity;
  readonly actualQuantity?: Quantity;
  readonly location: StorageLocation;
  /** Manual expiry override at purchase time, mirrors `PurchaseEvent.expiryOverride`. */
  readonly expiryOverride?: IsoDate;
}
