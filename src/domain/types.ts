/**
 * Domain entity and value types — WP-02.
 *
 * FROZEN: see src/domain/README.md. Every other work package codes directly
 * against these shapes without being able to change them; a field renamed or
 * reshaped here breaks seven packages at once. Changes only via a dedicated
 * contract-change task approved by the coordinator.
 *
 * Zero imports, zero runtime dependencies. Pure types plus trivial validating
 * constructors (`make*`) — no engine logic, no I/O, no Date.now()/Math.random().
 */

// ---------------------------------------------------------------------------
// Branded IDs
//
// Every entity id is a nominal (branded) string: structurally a string at
// runtime, but distinguishable from a bare `string` and from every other
// branded id at compile time. Passing a RecipeId where an IngredientId is
// expected is a type error, not a runtime bug seven packages could each
// reintroduce independently.
// ---------------------------------------------------------------------------

type Brand<T, B extends string> = T & { readonly __brand: B };

export type IngredientId = Brand<string, "IngredientId">;
export type RecipeId = Brand<string, "RecipeId">;
export type LotId = Brand<string, "LotId">;
export type PlanSlotId = Brand<string, "PlanSlotId">;
export type EventId = Brand<string, "EventId">;
export type PriceObservationId = Brand<string, "PriceObservationId">;
/**
 * A `RecipeStep`'s stable identity (WP-PHOTO — DESIGN_PHOTOS.md §3).
 * Previously a step was addressed only by its position (`stepNumber`
 * within a recipe) — reordering or deleting a step would silently
 * reassign any photo keyed on that position to the wrong instruction,
 * with nothing erroring. `StepId` is minted client-side (`newStepId`,
 * src/domain/ids.ts) exactly like every other id, and `Photo` keys on it
 * instead of `(recipeId, stepNumber)`.
 */
export type StepId = Brand<string, "StepId">;

function assertNonEmpty(raw: string, label: string): void {
  if (raw.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string, got ${JSON.stringify(raw)}`);
  }
}

/** Validating constructor: wraps a raw string as an IngredientId. */
export function makeIngredientId(raw: string): IngredientId {
  assertNonEmpty(raw, "IngredientId");
  return raw as IngredientId;
}

/** Validating constructor: wraps a raw string as a RecipeId. */
export function makeRecipeId(raw: string): RecipeId {
  assertNonEmpty(raw, "RecipeId");
  return raw as RecipeId;
}

/** Validating constructor: wraps a raw string as a LotId. */
export function makeLotId(raw: string): LotId {
  assertNonEmpty(raw, "LotId");
  return raw as LotId;
}

/** Validating constructor: wraps a raw string as a PlanSlotId. */
export function makePlanSlotId(raw: string): PlanSlotId {
  assertNonEmpty(raw, "PlanSlotId");
  return raw as PlanSlotId;
}

/** Validating constructor: wraps a raw string as an EventId. */
export function makeEventId(raw: string): EventId {
  assertNonEmpty(raw, "EventId");
  return raw as EventId;
}

/** Validating constructor: wraps a raw string as a PriceObservationId. */
export function makePriceObservationId(raw: string): PriceObservationId {
  assertNonEmpty(raw, "PriceObservationId");
  return raw as PriceObservationId;
}

/** Validating constructor: wraps a raw string as a StepId. */
export function makeStepId(raw: string): StepId {
  assertNonEmpty(raw, "StepId");
  return raw as StepId;
}

// ---------------------------------------------------------------------------
// Barcode (M6-A — DESIGN_PRODUCTS.md §2)
//
// A separate brand from the other ids above: a barcode is scanned/typed by a
// human, not client-minted (contrast EventId/LotId, which `ids.ts` mints via
// the injected Rng), and it has a real external format (EAN-8/UPC-A/EAN-13/
// GTIN-14) worth validating at construction time rather than "any non-empty
// string".
// ---------------------------------------------------------------------------

export type Barcode = Brand<string, "Barcode">;

const BARCODE_RE = /^\d{6,14}$/;

/** Validating constructor: wraps a raw string as a Barcode. Accepts 6-14 digits (covers UPC-E/EAN-8/UPC-A/EAN-13/GTIN-14). */
export function makeBarcode(raw: string): Barcode {
  if (!BARCODE_RE.test(raw)) {
    throw new Error(`Barcode must be 6-14 digits, got ${JSON.stringify(raw)}`);
  }
  return raw as Barcode;
}

// ---------------------------------------------------------------------------
// Units & quantities
//
// Invariant 3 (HANDOVER §4): exactly one canonical unit per ingredient, no
// conversion logic anywhere. A bare `number` quantity lets a caller silently
// mix grams and millilitres; pairing amount+unit in one value type makes the
// mismatch visible in every signature that touches quantities. No arithmetic
// helpers live here beyond the constructor — see src/domain/quantity.ts for
// the (non-converting) same-unit helpers engines use.
// ---------------------------------------------------------------------------

/**
 * Canonical units. `portion` is the leftover unit (DESIGN.md §2 "Servings,
 * scaling & leftovers" / glossary "Leftover lot"). `g`, `ml`, `piece` cover
 * every example ingredient in DESIGN.md §2 and the WP-16 seed-catalog
 * description; DESIGN.md's non-goals explicitly rule out unit conversion, so
 * there is deliberately no `kg`/`l` alongside `g`/`ml` — one scale per kind
 * of quantity, matching "one canonical unit per ingredient".
 */
export type Unit = "g" | "ml" | "piece" | "portion";

export interface Quantity {
  readonly amount: number;
  readonly unit: Unit;
}

/**
 * Validating constructor. Only checks the amount is a finite number — it does
 * NOT reject negative amounts, because `AdjustEvent.delta` (see below) is a
 * signed correction and reuses this same value type. Non-negativity for
 * absolute quantities (lots, purchases, use/spoil amounts) is a codec/engine
 * concern (WP-11/WP-12), not a shape concern.
 */
export function makeQuantity(amount: number, unit: Unit): Quantity {
  if (!Number.isFinite(amount)) {
    throw new Error(`Quantity amount must be a finite number, got ${amount}`);
  }
  return { amount, unit };
}

/**
 * Units a human can enter in the product editor (M6-A — DESIGN_PRODUCTS.md
 * §3), deliberately a *different* type from `Unit`. `Unit` stays exactly
 * `g | ml | piece | portion` (invariant 3) — nothing here widens it. An
 * `EntryUnit` is converted into an ingredient's canonical `Unit` exactly
 * once, by `src/domain/units.ts`, before anything is written; it is never
 * itself used in arithmetic. `"piece"` here is the same concept the design
 * doc calls "number" for a count-based product (e.g. "12 eggs") — spelled
 * `"piece"` to match `Unit`'s existing count label instead of introducing a
 * second word for the same idea.
 */
/**
 * WP-PURCHASING (DESIGN_PURCHASING.md §10.3) added `"cup" | "tbsp" | "tsp"` —
 * additive to the union, nothing existing renamed. These three are volume
 * units like `l`/`ml`/`fl oz` (exact ml-scale constants, §10.2: the US legal
 * set — 1 cup = 240 ml, 1 tbsp = 15 ml, 1 tsp = 5 ml), but converting one of
 * them into a MASS canonical unit (e.g. "1 cup flour" -> grams) additionally
 * needs the target ingredient's density (`Ingredient.gramsPerMl`, §10.1a) —
 * see `src/domain/units.ts`'s `convertEntryToCanonical`, which takes that as
 * an optional third argument rather than guessing.
 */
export type EntryUnit = "kg" | "g" | "lb" | "oz" | "l" | "ml" | "fl oz" | "piece" | "cup" | "tbsp" | "tsp";

// ---------------------------------------------------------------------------
// Dates
//
// Branded ISO strings, never `Date` objects: they round-trip through Sheets
// cells as plain text (invariant 6, human-readable workbook), and `Date`
// objects make pure engines non-deterministic / non-serialisable. See
// src/domain/dates.ts for pure date math built on these.
// ---------------------------------------------------------------------------

/** Calendar day, `YYYY-MM-DD`. Used for expiry, purchase/cook date, plan slot date. */
export type IsoDate = Brand<string, "IsoDate">;

/** Full ISO 8601 timestamp. Used for event timestamps (order + audit trail). */
export type IsoTimestamp = Brand<string, "IsoTimestamp">;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** Validating constructor for a calendar-day string (`YYYY-MM-DD`). */
export function makeIsoDate(raw: string): IsoDate {
  if (!ISO_DATE_RE.test(raw)) {
    throw new Error(`IsoDate must match YYYY-MM-DD, got ${JSON.stringify(raw)}`);
  }
  const [y, m, d] = raw.split("-").map(Number) as [number, number, number];
  if (!isValidCalendarDate(y, m, d)) {
    throw new Error(`IsoDate is not a valid calendar date: ${JSON.stringify(raw)}`);
  }
  return raw as IsoDate;
}

/** Validating constructor for a full ISO-8601 timestamp string. */
export function makeIsoTimestamp(raw: string): IsoTimestamp {
  if (!ISO_TIMESTAMP_RE.test(raw)) {
    throw new Error(`IsoTimestamp must be a full ISO-8601 timestamp, got ${JSON.stringify(raw)}`);
  }
  if (Number.isNaN(Date.parse(raw))) {
    throw new Error(`IsoTimestamp is not a parseable date-time: ${JSON.stringify(raw)}`);
  }
  return raw as IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Workbook schema — sheet names (DESIGN.md §3)
// ---------------------------------------------------------------------------

export type WorkbookSheetName =
  | "Meta"
  | "Settings"
  | "Ingredients"
  | "Recipes"
  | "RecipeIngredients"
  | "RecipeSteps"
  | "PlanSlots"
  | "InventoryEvents"
  | "ShoppingItems"
  | "Products"
  | "Photos"
  | "PriceObservations";

// ---------------------------------------------------------------------------
// Shared enums-as-unions (erasableSyntaxOnly forbids real `enum`)
// ---------------------------------------------------------------------------

export type StorageLocation = "pantry" | "fridge" | "freezer";

/**
 * Shopping-list grouping (WP-VC3 — coordinator-approved contract change,
 * additive only). Matches the seed catalog's own comment groups
 * (`src/data/seed-catalog.ts`, previously comment-only): produce, dairy &
 * eggs, meat & fish, dry goods, tinned/jarred, frozen, condiments, baking,
 * herbs & spices, drinks.
 */
export type IngredientCategory =
  | "produce"
  | "dairy-eggs"
  | "meat-fish"
  | "dry-goods"
  | "tinned-jarred"
  | "frozen"
  | "condiments"
  | "baking"
  | "herbs-spices"
  | "drinks";

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** Meal-type tag; also used as a PlanSlot's slot type (DESIGN.md §2 "Planning"). */
export type MealTag = "breakfast" | "lunch" | "dinner" | "snack";

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

export interface Ingredient {
  readonly id: IngredientId;
  readonly name: string;
  /** The ingredient's one canonical unit (invariant 3). */
  readonly unit: Unit;
  /** Unopened shelf life, in days, from the default storage location. */
  readonly shelfLifeDays: number;
  /** Shelf life, in days, once a lot of this ingredient has been opened. */
  readonly openedShelfLifeDays: number;
  readonly defaultLocation: StorageLocation;
  /**
   * Shopping-list grouping (WP-VC3, additive — same `?` pattern as
   * `Settings.currency` from M6-A). Optional so every `Ingredient` literal
   * written before this change (fakes, contract tests, fixtures) keeps
   * compiling without it. Absent means "uncategorised" — the shopping list
   * groups those under an "Other" section rather than omitting them, and a
   * legacy workbook row with no `category` cell decodes to `undefined`
   * here, never a quarantined row (see `decodeIngredient`,
   * src/sheets/codecs/ingredients.ts).
   */
  readonly category?: IngredientCategory;
  /**
   * Denormalised photo-presence hint (WP-PHOTO — DESIGN_PHOTOS.md,
   * same purpose as `Product.hasPhoto` below): lets a list decide
   * skeleton-vs-placeholder without a `Photos.get()` round trip per row.
   * Optional/additive, same pattern as `category` — a legacy row with no
   * cell here decodes to `undefined` (treated as "no photo"), never a
   * quarantined row. The actual photo bytes live only in the `Photos`
   * sheet, keyed on `(ownerKind: "ingredient", ownerId: this.id)`; this
   * flag is not a substitute for reading it, only a hint for rendering
   * before that read resolves.
   */
  readonly hasPhoto?: boolean;
  /**
   * WP-PURCHASING (DESIGN_PURCHASING.md §3/§7), additive. How this
   * ingredient is bought: `"whole"` (indivisible units — a jar, an onion,
   * `buy = ceil(need / packSize) * packSize`) or `"loose"` (any amount,
   * `buy = need`, optionally rounded up to `roundTo`). Absent means "derive
   * from `unit`" — `piece`/`portion` default to `whole`, `g`/`ml` default to
   * `loose` (§3's table) — so every ingredient seeded before this change
   * keeps behaving exactly as it does today with zero data entry. See
   * `src/domain/purchasing.ts`'s `suggestPurchase`, the only place this is
   * read.
   */
  readonly purchaseMode?: "whole" | "loose";
  /**
   * Typical package size, in this ingredient's own canonical `unit`
   * (§3/§11.2 — e.g. a 250 g jar of mayonnaise). Only meaningful for
   * `purchaseMode: "whole"` (explicit or defaulted); absent there means
   * "one bare unit is the pack" (`packSize` of `{ amount: 1, unit }`) — the
   * `piece`/`portion` default from §3's table needs no packSize at all. A
   * specific `Product.canonicalQuantity` (M6-A), when known, overrides this
   * typical value — see DESIGN_PURCHASING.md §3's "ingredient is typical,
   * product is actual."
   */
  readonly packSize?: Quantity;
  /**
   * Loose-mode-only rounding step (§9.4/§11.3 — deferred, defined here only
   * because doing so costs nothing additive). Absent means "no rounding,
   * buy exactly the shortfall" (today's behaviour, unchanged). When set,
   * `suggestPurchase` rounds a loose ingredient's shortfall up to the
   * nearest multiple of this many canonical units (scenario 10).
   */
  readonly roundTo?: number;
  /**
   * Density — grams per millilitre of this specific ingredient (§10.1a: one
   * number, every volume entry unit — cup/tbsp/tsp/ml/l/fl oz — derives from
   * it). Enables volume-entered recipe quantities to convert into this
   * ingredient's canonical mass unit (`src/domain/units.ts`). Absent means
   * that conversion simply isn't offered (§10.1: never guess a density — a
   * default of 1.0 would overstate flour by ~80%).
   */
  readonly gramsPerMl?: number;
  /**
   * Typical weight of one piece/item, in grams (§9.1/§10: "1 onion weighs
   * 150 g"). Enables a count-entered recipe quantity ("2 tomatoes") to
   * convert into this ingredient's canonical mass unit when it is measured
   * by weight (e.g. re-united produce like Tomato). Absent means that
   * conversion isn't offered, same rule as `gramsPerMl`.
   */
  readonly gramsPerPiece?: number;
  /**
   * The container noun a household actually reaches for — "jar", "carton",
   * "box" — WP-purchasing-editor, dedicated coordinator-approved contract
   * change, additive-only. Purely a shopping-row display label: the
   * `whole`-mode buy amount renders as "1 jar" instead of "250 g" when this
   * is set (`src/routes/shopping/purchase-display.ts`), falling back to the
   * plain amount when absent — most ingredients never set this. Never read
   * by any engine or fold; it changes no arithmetic, only what the basket
   * line calls the thing.
   */
  readonly packLabel?: string;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export type RecipeKind = "cooked" | "bought";

/** Household-level 3-state rotation flag (DESIGN.md §2 "Voting / rotation"). */
export type RecipeStatus = "staple" | "in-rotation" | "retired";

export interface Recipe {
  readonly id: RecipeId;
  readonly name: string;
  readonly kind: RecipeKind;
  /** `kind: "bought"` recipes always have `prepMinutes === 0` (enforced by the codec/UI, not the type). */
  readonly baseServings: number;
  readonly prepMinutes: number;
  readonly cookMinutes: number;
  readonly mealTags: readonly MealTag[];
  readonly status: RecipeStatus;
  /** Denormalised photo-presence hint — see `Ingredient.hasPhoto`'s doc comment for the pattern; owner kind is `"recipe"`. */
  readonly hasPhoto?: boolean;
  /**
   * WP-PURCHASING (DESIGN_PURCHASING.md §4/§8), additive. `true` if this
   * recipe's yield cannot be subdivided — a bought lasagna, a whole quiche —
   * so scaling it to a household that isn't an exact multiple of
   * `baseServings` must round the number of *units made/bought* up, not the
   * ingredient amounts down to a fraction. Absent means `kind === "bought"`
   * (§4: "the obvious case"), so every recipe seeded before this change
   * keeps its existing behaviour with zero data entry; a cooked recipe can
   * still opt in explicitly. See `src/domain/purchasing.ts`'s
   * `scaleIndivisible`, the only place this is read.
   */
  readonly indivisible?: boolean;
}

/** One row per (recipe, ingredient) — join row, not a wide column or JSON blob. */
export interface RecipeIngredient {
  readonly recipeId: RecipeId;
  readonly ingredientId: IngredientId;
  /** Quantity needed at the recipe's `baseServings`; the planner scales this. */
  readonly quantity: Quantity;
  /**
   * WP-PURCHASING (DESIGN_PURCHASING.md §10.3), additive, provenance only —
   * mirrors `Product.displayQuantity`/`displayUnit`'s settled pattern
   * exactly. What the recipe author actually typed ("1", `"cup"`) before
   * entry-time conversion (`src/domain/units.ts`) turned it into `quantity`
   * (always canonical grams/millilitres/pieces). Nothing in `src/domain`,
   * `src/sheets`, or any fold may read either field to compute anything —
   * `quantity` alone is what arithmetic touches.
   */
  readonly displayQuantity?: number;
  /** As entered by the human (`"cup"`), display/provenance only — never used in arithmetic. See `displayQuantity`. */
  readonly displayUnit?: EntryUnit;
}

/**
 * One row per (recipe, step) — numbered instruction line (WP-PHOTO widened
 * this, DESIGN_PHOTOS.md §3).
 *
 * `id` is the step's stable identity — **required**, not optional, because a
 * step without one is exactly the bug this widening exists to close: photos
 * (and anything else that needs to reference one specific step) key on `id`,
 * never on `stepNumber`. `stepNumber` stays purely the *ordering* field it
 * always was — reordering steps changes `stepNumber` on some rows without
 * touching `id`, so a photo keyed on `id` never silently jumps to a
 * different instruction the way it would if it were keyed on position.
 *
 * A legacy row written before this change has no `id` cell at all. The
 * codec (`src/sheets/codecs/recipe-steps.ts`) mints one deterministically
 * from `(recipeId, stepNumber)` on read, rather than throwing/quarantining
 * — see that file's `legacyStepId` for exactly how, and its own doc comment
 * for why determinism (not a random id) matters here: re-reading the same
 * unmigrated row twice must keep producing the same id, or two clients
 * would disagree about which step a given `Photo` row belongs to.
 *
 * `description`/`detail`/`durationMinutes` are new, owner-requested fields
 * (product-owner interview, 2026-08-20 — see DESIGN_PHOTOS.md's header).
 * `description` **replaces** the old required `text` field rather than
 * living alongside it: the two named the same thing (the always-visible
 * instruction line), and keeping both would mean every writer has to decide
 * which one is authoritative. `description` is still required, matching
 * `text`'s old cardinality — a step's headline text is not optional, only
 * the newly-added `detail` (a longer markdown body) and `durationMinutes`
 * are. A legacy row's old `text` cell decodes straight into `description`
 * (same column position — see the codec), so this rename costs no
 * migration.
 */
export interface RecipeStep {
  readonly recipeId: RecipeId;
  readonly id: StepId;
  readonly stepNumber: number;
  /** The short, always-visible instruction line — was `text` before WP-PHOTO; see this interface's doc comment. */
  readonly description: string;
  /** Longer markdown body, shown on demand (e.g. an expanded step view). Optional — most steps only need `description`. */
  readonly detail?: string;
  /** Estimated minutes this step takes, if the recipe author entered one (e.g. "simmer for 45 minutes" -> 45). Optional. */
  readonly durationMinutes?: number;
  /** Denormalised photo-presence hint — see `Ingredient.hasPhoto`'s doc comment for the pattern; owner kind is `"recipe-step"`, owner id is this step's `id`. */
  readonly hasPhoto?: boolean;
}

// ---------------------------------------------------------------------------
// Planning
//
// A PlanSlot must be able to hold a recipe OR a leftover lot OR nothing yet.
// A nullable `recipeId` with an untyped "null means leftover, unless..."
// convention is exactly the bug class this discriminated union rules out at
// compile time (design requirement 12) — every caller that pattern-matches
// `filling.kind` is forced by the compiler to handle all three cases.
// ---------------------------------------------------------------------------

export type PlanSlotFilling =
  | { readonly kind: "recipe"; readonly recipeId: RecipeId; readonly scaleServings?: number }
  | { readonly kind: "leftover"; readonly lotId: LotId }
  /**
   * WP-leftover-planning, coordinator-approved additive contract change. A
   * leftover the planner expects to exist once some OTHER slot is actually
   * cooked, but that hasn't happened yet — so there is no `LotId` to point
   * at (a `Lot` is only ever created by a `purchase` `InventoryEvent`, and
   * that only happens at "mark cooked" time, `createLeftoverLot`). Adding a
   * nullable `lotId` here would recreate exactly the "null means... unless"
   * bug class this union exists to rule out (see the file header comment
   * above `PlanSlotFilling`), so this is its own discriminated variant
   * instead.
   *
   * `sourceSlotId` names the `PlanSlot` expected to produce this leftover —
   * looked up live (never cached) so a dependent slot can tell whether its
   * source is still on track: still `planned` with the same `recipeId`
   * (contingent — the UI shows this plainly, no jargon), already `cooked`
   * (the planner should have bound this slot to the real `lotId` by now —
   * see `usePlanWeek.ts`'s mark-cooked flow), or gone (skipped/removed/
   * re-planned to a different recipe) — the last case is exactly "flags
   * rather than silently pointing at food that never existed" from the
   * work order, and is computed at render time, not stored, so it can never
   * go stale independently of the source row.
   *
   * `recipeId` is carried alongside `sourceSlotId` (rather than requiring a
   * lookup through the source slot for every render) purely so a dependent
   * slot can still say what it *expected* ("Leftover: Chili") even in the
   * broken case above, once the source's own filling has already changed to
   * something else or vanished.
   */
  | { readonly kind: "leftover-projected"; readonly sourceSlotId: PlanSlotId; readonly recipeId: RecipeId }
  | { readonly kind: "empty" };

export type PlanSlotState = "planned" | "cooked" | "skipped";

export interface PlanSlot {
  readonly id: PlanSlotId;
  readonly date: IsoDate;
  readonly slotType: MealTag;
  /**
   * 0-based position within that date's `DaySlotLayout.slots` array.
   * `DaySlotLayout.slots` may repeat a tag (e.g. two snack slots); slotType
   * alone cannot tell those two PlanSlots apart or give them a stable
   * display order, so this index does.
   */
  readonly slotIndex: number;
  readonly filling: PlanSlotFilling;
  readonly state: PlanSlotState;
  /** Generator hint: pinned slots are left untouched by reroll/regenerate. */
  readonly pinned: boolean;
}

// ---------------------------------------------------------------------------
// Inventory (event-sourced) — HANDOVER §4 invariant 1: rows are immutable.
//
// Every field on every variant, and everything reachable from it (Quantity),
// is `readonly`. There is no setter, no mutator, nothing in this module that
// could edit an event in place — violating invariant 1 is a compile error,
// not a code-review note.
//
// `use` carries only ingredientId + quantity, not a lotId: FIFO consumption
// (invariant 4) is a fold-time decision by the inventory engine (WP-12) over
// whichever lots exist at fold time, not a choice the event author
// (UI/outbox) makes per-event. `purchase`, `spoil`, `adjust`, `move`, `open`
// all name a specific lot because they are inherently lot-specific
// operations — see `SpoilEvent`'s doc comment for why it differs from `use`
// even though invariant 1 lists both as "consumption".
// ---------------------------------------------------------------------------

interface InventoryEventBase {
  /** Client-generated at creation time (design requirement 3) — never assigned by the sheet. */
  readonly id: EventId;
  readonly timestamp: IsoTimestamp;
  readonly ingredientId: IngredientId;
}

export interface PurchaseEvent extends InventoryEventBase {
  readonly type: "purchase";
  /** Client-generated id for the new lot this purchase creates. */
  readonly lotId: LotId;
  readonly quantity: Quantity;
  readonly location: StorageLocation;
  readonly purchaseDate: IsoDate;
  /** Manual expiry override at purchase time, if the catalog default is wrong for this lot. */
  readonly expiryOverride?: IsoDate;
}

/** FIFO-consumed across existing lots for `ingredientId` at fold time. */
export interface UseEvent extends InventoryEventBase {
  readonly type: "use";
  readonly quantity: Quantity;
}

/**
 * Names a specific lot — deliberately unlike `UseEvent`. Invariant 4's FIFO
 * requirement scopes to "usage, shopping allocation" only; spoilage is not
 * in that list. A user looking at the pantry view (WP-21, "grouped by
 * ingredient with lots") identifies spoilage by *looking at a lot* — a
 * visibly mouldy lot in the fridge might be newer than an untouched lot in
 * the freezer, so FIFO-oldest would name the wrong one. "Lot X spoiled" is
 * the fact being recorded, not "some quantity of ingredient Y spoiled,
 * figure out which lot." Do not remove `lotId` to make this symmetric with
 * `UseEvent` — the asymmetry is intentional, see coordinator review on
 * WP-02's PR.
 */
export interface SpoilEvent extends InventoryEventBase {
  readonly type: "spoil";
  readonly lotId: LotId;
  readonly quantity: Quantity;
}

/**
 * A correction to a specific lot (invariant 1: corrections are new events,
 * never edits to a prior row). Two independent kinds of correction share
 * this one event type rather than getting a seventh event kind, per
 * DESIGN.md/WP-02's scope fixing the union at exactly six types:
 *
 * - `delta`: a signed quantity correction. Positive adds back, negative
 *   removes.
 * - `expiry`: a replacement expiry for the lot (DESIGN.md §2 "Overrides:
 *   the user can hand-edit any lot's expiry when reality disagrees"). A
 *   fold that applies an `expiry` correction sets the resulting `Lot`'s
 *   `expiryOverridden` to `true` — this is the only event that can produce
 *   that state after purchase time (`PurchaseEvent.expiryOverride` only
 *   covers purchase time).
 *
 * At least one of `delta`/`expiry` must be present — use `makeAdjustEvent`
 * rather than an object literal, it enforces this. WP-11's codec must
 * likewise reject a decoded row with neither (as a data warning, not a
 * throw — see `DataWarning`/`DecodeResult`).
 */
export interface AdjustEvent extends InventoryEventBase {
  readonly type: "adjust";
  readonly lotId: LotId;
  readonly delta?: Quantity;
  readonly expiry?: IsoDate;
  readonly reason?: string;
}

export interface AdjustEventInput {
  readonly id: EventId;
  readonly timestamp: IsoTimestamp;
  readonly ingredientId: IngredientId;
  readonly lotId: LotId;
  readonly delta?: Quantity;
  readonly expiry?: IsoDate;
  readonly reason?: string;
}

/** Validating constructor: throws unless at least one of `delta`/`expiry` is given. */
export function makeAdjustEvent(input: AdjustEventInput): AdjustEvent {
  if (input.delta === undefined && input.expiry === undefined) {
    throw new Error("AdjustEvent requires at least one of `delta` or `expiry`");
  }
  return {
    type: "adjust",
    id: input.id,
    timestamp: input.timestamp,
    ingredientId: input.ingredientId,
    lotId: input.lotId,
    ...(input.delta !== undefined ? { delta: input.delta } : {}),
    ...(input.expiry !== undefined ? { expiry: input.expiry } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };
}

/** Location change for a specific lot (e.g. pantry → freezer suspends expiry). */
export interface MoveEvent extends InventoryEventBase {
  readonly type: "move";
  readonly lotId: LotId;
  readonly location: StorageLocation;
}

/** Marks a specific lot opened; the fold recomputes its expiry from `openedShelfLifeDays`. */
export interface OpenEvent extends InventoryEventBase {
  readonly type: "open";
  readonly lotId: LotId;
}

export type InventoryEvent =
  | PurchaseEvent
  | UseEvent
  | SpoilEvent
  | AdjustEvent
  | MoveEvent
  | OpenEvent;

// ---------------------------------------------------------------------------
// Lots & snapshot
// ---------------------------------------------------------------------------

export interface Lot {
  readonly id: LotId;
  readonly ingredientId: IngredientId;
  /** Quantity remaining after folding all consumption to date. */
  readonly quantity: Quantity;
  readonly purchaseDate: IsoDate;
  readonly location: StorageLocation;
  /** Always a concrete date — freezer suspension is expressed as a far-future expiry, never null. */
  readonly expiry: IsoDate;
  readonly openedAt?: IsoDate;
  /** True if `expiry` came from a manual override rather than catalog defaults. */
  readonly expiryOverridden: boolean;
}

/**
 * Cursor + generation always travel together (design requirement 8): a
 * Snapshot cannot be constructed without both, and any code that needs to
 * check "is my cached generation still valid" operates on this shape rather
 * than two independently-optional numbers floating around.
 */
export interface SnapshotCursor {
  readonly generation: number;
  /** Last InventoryEvents data-row index (0-based, header excluded) folded into this snapshot. */
  readonly cursor: number;
}

export interface Snapshot extends SnapshotCursor {
  readonly lots: readonly Lot[];
}

// ---------------------------------------------------------------------------
// Settings & Meta
// ---------------------------------------------------------------------------

export interface DaySlotLayout {
  readonly day: Weekday;
  /** Ordered slot types for this day; a day may repeat a tag (e.g. two snack slots). */
  readonly slots: readonly MealTag[];
}

export interface Settings {
  readonly householdSize: number;
  readonly slotLayout: readonly DaySlotLayout[];
  /** N-week window: recipes cooked within this many weeks are excluded from the generator. */
  readonly repeatExclusionWeeks: number;
  /**
   * Single household currency symbol/code (M6-A — DESIGN_PRODUCTS.md §4:
   * "a single value in Settings, defaulting to `$`. Not per-row — the
   * household has one currency."). Optional, not required, so this addition
   * stays additive: every `Settings` object literal written before M6-A
   * (fixtures, other work packages' tests) still type-checks without it.
   * Absent means "$" — see `DEFAULT_SETTINGS` (src/sheets/bootstrap.ts) and
   * `decodeSettings` (src/sheets/codecs/settings.ts), which both apply that
   * default explicitly rather than leaving callers to do it ad hoc.
   */
  readonly currency?: string;
  /**
   * WP-leftover-planning, coordinator-approved additive contract change,
   * same `?` pattern as `currency` above so every `Settings` literal written
   * before today (fixtures, other work packages' tests) still type-checks.
   * The reuse gap: the minimum number of OTHER planned meal slots — of any
   * type, a breakfast counts the same as a dinner — that must fall between
   * a meal and any slot the generator fills from its leftovers (real or
   * projected). Counted in slots, not days or meals-of-the-same-type,
   * because the owner's decision was explicit that a household eating
   * breakfast/lunch/dinner shouldn't see the same leftover twice within a
   * handful of meals regardless of which meal types those are.
   *
   * Absent means 2 (`DEFAULT_REUSE_GAP_SLOTS`, `src/domain/planner/
   * leftover-projection.ts`) — enough that a leftover never lands in the
   * very next slot (which would read as "we just ate this"), while staying
   * short enough that a short shelf life (leftovers, `LEFTOVER_FRIDGE_
   * SHELF_LIFE_DAYS` = 4 days) doesn't expire before the gap is satisfied
   * for a household with 2-3 slots/day. See `DEFAULT_SETTINGS`
   * (src/sheets/bootstrap.ts) and `decodeSettings`
   * (src/sheets/codecs/settings.ts), which both apply that default
   * explicitly, exactly like `currency`/`DEFAULT_CURRENCY`.
   */
  readonly reuseGapSlots?: number;
}

export interface Meta {
  readonly schemaVersion: number;
  readonly generation: number;
}

// ---------------------------------------------------------------------------
// Shopping
// ---------------------------------------------------------------------------

export interface ShoppingItem {
  readonly ingredientId: IngredientId;
  readonly rangeStart: IsoDate;
  readonly rangeEnd: IsoDate;
  readonly neededQuantity: Quantity;
  readonly checked: boolean;
  readonly boughtQuantity?: Quantity;
  /**
   * WP-PURCHASING (DESIGN_PURCHASING.md §7), additive. The engine-computed
   * purchasable amount at the time this row was last written (`g`/`ml` and
   * `piece`/`portion` alike — see `src/domain/purchasing.ts`'s
   * `suggestPurchase`). Persisted alongside `neededQuantity` purely so a
   * checked-off row can still show what was suggested without recomputing
   * the whole engine; never itself read by any engine.
   */
  readonly suggestedPurchase?: Quantity;
  /**
   * The household's own explicit buy-amount choice (§6 scenario 9 — "I want
   * 500 g of tomatoes"), persisted so it **survives a plan recompute**: a
   * reroll changes `neededQuantity`/`suggestedPurchase`, never a choice the
   * household already made about what to buy. Present only once a shopper
   * has used the adjust stepper; absent means "use `suggestedPurchase`."
   */
  readonly purchaseOverride?: Quantity;
}

// ---------------------------------------------------------------------------
// Products, photos & prices (M6-A — DESIGN_PRODUCTS.md §2)
//
// A Product is a new first-class entity, distinct from an Ingredient: an
// ingredient is *rice*, a product is *Riso Gallo Arborio 1 kg, barcode
// 8001120000123*. Many products map to one ingredient (`ingredientId`).
//
// `canonicalQuantity` is the ONLY field arithmetic ever touches — it is
// always in the linked ingredient's canonical `Unit` (invariant 3).
// `displayQuantity`/`displayUnit` are exactly what the human typed at entry
// time ("1", "lb" -> "1 lb bag"), kept for display/provenance only. Nothing
// in `src/domain`, `src/sheets`, or any fold may read `displayQuantity`/
// `displayUnit` to compute anything — see `src/domain/units.ts`, the single
// module allowed to turn one into the other, and only at entry time.
// ---------------------------------------------------------------------------

export interface Product {
  readonly barcode: Barcode;
  readonly name: string;
  readonly brand?: string;
  readonly ingredientId: IngredientId;
  /** Package size in the ingredient's canonical unit — drives all arithmetic. Never hand-edit without going through src/domain/units.ts. */
  readonly canonicalQuantity: Quantity;
  /** As entered by the human ("1"), display/provenance only — never used in arithmetic. */
  readonly displayQuantity: number;
  /** As entered by the human ("lb"), display/provenance only — never used in arithmetic. */
  readonly displayUnit: EntryUnit;
  /** Unopened shelf life, in days, for a purchased unit of this specific product. */
  readonly shelfLifeDays: number;
  readonly isBulk: boolean;
  /** Denormalised presence flag so a `Products.readAll()` listing never needs to touch `Photos` (see `Photo` below) just to know whether to show a placeholder. Same pattern as `Ingredient.hasPhoto`/`Recipe.hasPhoto`/`RecipeStep.hasPhoto` above, except required here rather than optional — `Product` was already M6-A's own entity with no legacy rows to stay compatible with. */
  readonly hasPhoto: boolean;
}

// ---------------------------------------------------------------------------
// Photos — one sheet for every photo-owning entity (WP-PHOTO —
// DESIGN_PHOTOS.md, superseding M6-A's per-entity `ProductPhotos` sheet).
//
// Four entities want photos: recipes, recipe steps, ingredients, and
// products. One `Photos` sheet keyed on `(ownerKind, ownerId)` means one
// codec, one lazy-fetch path, one place enforcing the byte budget — see
// DESIGN_PHOTOS.md §1 for why three-or-four parallel sheets was rejected.
// ---------------------------------------------------------------------------

/** Which kind of entity a `Photo` row belongs to (DESIGN_PHOTOS.md §2). */
export type PhotoOwnerKind = "recipe" | "recipe-step" | "ingredient" | "product";

/** A `Photo`'s owner id — whichever branded id matches its `ownerKind`. */
export type PhotoOwnerId = RecipeId | StepId | IngredientId | Barcode;

/**
 * Hard Google Sheets per-cell character ceiling (DESIGN_PHOTOS.md §4,
 * DESIGN_PRODUCTS.md §5 — the limit is reused verbatim, not re-litigated).
 * Lives here, not just in the codec, because it is part of the
 * `WorkbookStore.photos` *contract*, not an implementation detail of one
 * backend: both `src/sheets/codecs/photos.ts` (the real, Sheets-backed
 * codec) and `src/domain/fakes/workbook-store.ts` (the in-memory fake every
 * other work package tests against) must refuse an oversized `dataUrl`
 * identically, or a package developing against the fake would never see the
 * failure the real backend enforces. Was `MAX_PRODUCT_PHOTO_DATA_URL_LENGTH`
 * before this sheet absorbed `ProductPhotos` — same value (50,000), renamed
 * to match the one sheet it now bounds.
 */
export const MAX_PHOTO_DATA_URL_LENGTH = 50_000;

/**
 * Deliberately its own sheet, not a column on any owning entity
 * (DESIGN_PHOTOS.md §2/§6): `WorkbookStore.<entity>.readAll()` would
 * otherwise drag every row's photo down the wire on every listing. Access is
 * by key only (`WorkbookStore.photos.get`), on demand, for whichever items
 * are currently visible — see that namespace's own doc comment in
 * contracts.ts for why it deliberately has **no `readAll`**.
 *
 * `(ownerKind, ownerId)` is the key — insert-or-replace by that pair,
 * exactly like `ingredients.upsert` by id.
 *
 * `dataUrl` is a bounded, documented exception to invariant 6
 * ("human-readable workbook, no blobs") — one column, one sheet. See
 * DESIGN_PHOTOS.md §4 for the byte budget the encoder targets and
 * `MAX_PHOTO_DATA_URL_LENGTH` above for the hard backstop every
 * `WorkbookStore` implementation enforces on write.
 */
export interface Photo {
  readonly ownerKind: PhotoOwnerKind;
  readonly ownerId: PhotoOwnerId;
  readonly dataUrl: string;
  /** Lets a client cache and revalidate without diffing blobs (DESIGN_PHOTOS.md §2). */
  readonly updatedAt: IsoTimestamp;
}

/**
 * Append-only time series, like `InventoryEvents` (DESIGN_PRODUCTS.md §2:
 * "corrections are new rows, and two clients appending never collide").
 * `WorkbookStore.priceObservations` therefore exposes no update/delete
 * method, only append (contracts.ts).
 *
 * No currency field by design — the household has exactly one currency,
 * held in `Settings.currency` and applied at display time, not stored
 * per-row. `quantity` is in the linked ingredient's canonical unit (same
 * rule as `Product.canonicalQuantity`), so `price` divided by `quantity`
 * needs no unit conversion to be meaningful; see
 * `src/domain/price-normalization.ts` for comparing observations of
 * different package sizes on a common per-100g/per-100ml/per-piece basis.
 */
export interface PriceObservation {
  readonly id: PriceObservationId;
  readonly timestamp: IsoTimestamp;
  /** Which specific product this price was seen on, if scanned rather than entered against a bare ingredient. */
  readonly barcode?: Barcode;
  readonly ingredientId: IngredientId;
  readonly quantity: Quantity;
  /** In the household's single currency (`Settings.currency`). */
  readonly price: number;
  /** Free-text provenance ("Trader Joe's", "corner store") — DESIGN_PRODUCTS.md §7 defers a structured `Shops` sheet to M7; this column is why that later addition won't require rewriting price history. */
  readonly source?: string;
}
