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
  | "ShoppingItems";

// ---------------------------------------------------------------------------
// Shared enums-as-unions (erasableSyntaxOnly forbids real `enum`)
// ---------------------------------------------------------------------------

export type StorageLocation = "pantry" | "fridge" | "freezer";

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
}

/** One row per (recipe, ingredient) — join row, not a wide column or JSON blob. */
export interface RecipeIngredient {
  readonly recipeId: RecipeId;
  readonly ingredientId: IngredientId;
  /** Quantity needed at the recipe's `baseServings`; the planner scales this. */
  readonly quantity: Quantity;
}

/** One row per (recipe, step number) — numbered instruction line. */
export interface RecipeStep {
  readonly recipeId: RecipeId;
  readonly stepNumber: number;
  readonly text: string;
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
}
