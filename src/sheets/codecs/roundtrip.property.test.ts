/**
 * Property tests (WP-11 success criterion: "Codec property tests: encode→
 * decode is identity for all entity types"). For every sheet, an arbitrary
 * valid entity is generated, encoded to a `CellRow` (or rows, for the
 * singleton Meta/Settings sheets), decoded back, and asserted deep-equal to
 * the original — proving the round trip is lossless across the whole
 * domain of values each field actually allows (not just the hand-picked
 * examples in workbook-store.contract.test.ts).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  makeAdjustEvent,
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makePlanSlotId,
  makeQuantity,
  makeRecipeId,
  type Ingredient,
  type IsoDate,
  type IsoTimestamp,
  type MealTag,
  type PlanSlot,
  type PlanSlotFilling,
  type PlanSlotState,
  type Recipe,
  type RecipeIngredient,
  type RecipeKind,
  type RecipeStatus,
  type RecipeStep,
  type Settings,
  type ShoppingItem,
  type StorageLocation,
  type Unit,
} from "../../domain/types.ts";
import {
  decodeIngredient,
  decodeInventoryEvent,
  decodeMeta,
  decodePlanSlot,
  decodeRecipe,
  decodeRecipeIngredient,
  decodeRecipeStep,
  decodeSettings,
  decodeShoppingItem,
  encodeIngredient,
  encodeInventoryEvent,
  encodeMeta,
  encodePlanSlot,
  encodeRecipe,
  encodeRecipeIngredient,
  encodeRecipeStep,
  encodeSettings,
  encodeShoppingItem,
  MEAL_TAGS,
  STORAGE_LOCATIONS,
  UNITS,
  WEEKDAYS,
} from "./index.ts";

// --- Shared building blocks --------------------------------------------------

const idArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

const UNIT_ARB = fc.constantFrom<Unit>(...UNITS);
const LOCATION_ARB = fc.constantFrom<StorageLocation>(...STORAGE_LOCATIONS);
const MEAL_TAG_ARB = fc.constantFrom<MealTag>(...MEAL_TAGS);

const BASE_UTC = Date.UTC(2026, 0, 1, 0, 0, 0);

function isoDateAt(dayOffset: number): IsoDate {
  return makeIsoDate(new Date(BASE_UTC + dayOffset * 86_400_000).toISOString().slice(0, 10));
}

const isoDateArb = fc.integer({ min: 0, max: 3650 }).map(isoDateAt);

// --- Ingredients --------------------------------------------------------------

const ingredientArb: fc.Arbitrary<Ingredient> = fc.record({
  id: idArb.map(makeIngredientId),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  unit: UNIT_ARB,
  shelfLifeDays: fc.integer({ min: 0, max: 5000 }),
  openedShelfLifeDays: fc.integer({ min: 0, max: 5000 }),
  defaultLocation: LOCATION_ARB,
});

describe("Ingredient codec", () => {
  it("encode -> decode is identity", () => {
    fc.assert(
      fc.property(ingredientArb, (ingredient) => {
        expect(decodeIngredient(encodeIngredient(ingredient))).toEqual(ingredient);
      }),
    );
  });
});

// --- Recipes --------------------------------------------------------------

const recipeBaseArb = fc.record({
  id: idArb.map(makeRecipeId),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  kind: fc.constantFrom<RecipeKind>("cooked", "bought"),
  baseServings: fc.integer({ min: 1, max: 20 }),
  cookMinutes: fc.integer({ min: 0, max: 600 }),
  mealTags: fc.array(MEAL_TAG_ARB, { maxLength: 4 }),
  status: fc.constantFrom<RecipeStatus>("staple", "in-rotation", "retired"),
});

const recipeArb: fc.Arbitrary<Recipe> = recipeBaseArb.chain((base) => {
  const prepMinutesArb = base.kind === "bought" ? fc.constant(0) : fc.integer({ min: 0, max: 180 });
  return prepMinutesArb.map((prepMinutes) => ({ ...base, prepMinutes }));
});

describe("Recipe codec", () => {
  it("encode -> decode is identity", () => {
    fc.assert(
      fc.property(recipeArb, (recipe) => {
        expect(decodeRecipe(encodeRecipe(recipe))).toEqual(recipe);
      }),
    );
  });
});

// --- RecipeIngredients ------------------------------------------------------

const recipeIngredientArb: fc.Arbitrary<RecipeIngredient> = fc.record({
  recipeId: idArb.map(makeRecipeId),
  ingredientId: idArb.map(makeIngredientId),
  amount: fc.integer({ min: 1, max: 100_000 }),
  unit: UNIT_ARB,
}).map(({ recipeId, ingredientId, amount, unit }) => ({
  recipeId,
  ingredientId,
  quantity: makeQuantity(amount, unit),
}));

describe("RecipeIngredient codec", () => {
  it("encode -> decode is identity when the ingredient's canonical unit matches", () => {
    fc.assert(
      fc.property(recipeIngredientArb, (line) => {
        const decoded = decodeRecipeIngredient(encodeRecipeIngredient(line), () => line.quantity.unit);
        expect(decoded).toEqual(line);
      }),
    );
  });
});

// --- RecipeSteps ------------------------------------------------------------

const recipeStepArb: fc.Arbitrary<RecipeStep> = fc.record({
  recipeId: idArb.map(makeRecipeId),
  stepNumber: fc.integer({ min: 1, max: 50 }),
  text: fc.string({ minLength: 1, maxLength: 200 }),
});

describe("RecipeStep codec", () => {
  it("encode -> decode is identity", () => {
    fc.assert(
      fc.property(recipeStepArb, (step) => {
        expect(decodeRecipeStep(encodeRecipeStep(step))).toEqual(step);
      }),
    );
  });
});

// --- PlanSlots ----------------------------------------------------------------

const recipeFillingArb: fc.Arbitrary<PlanSlotFilling> = fc
  .record({
    recipeId: idArb.map(makeRecipeId),
    scaleServings: fc.option(fc.integer({ min: 1, max: 30 }), { nil: undefined }),
  })
  .map(({ recipeId, scaleServings }) => ({
    kind: "recipe" as const,
    recipeId,
    ...(scaleServings !== undefined ? { scaleServings } : {}),
  }));

const leftoverFillingArb: fc.Arbitrary<PlanSlotFilling> = idArb
  .map(makeLotId)
  .map((lotId) => ({ kind: "leftover" as const, lotId }));

const emptyFillingArb: fc.Arbitrary<PlanSlotFilling> = fc.constant({ kind: "empty" as const });

const fillingArb: fc.Arbitrary<PlanSlotFilling> = fc.oneof(recipeFillingArb, leftoverFillingArb, emptyFillingArb);

const planSlotArb: fc.Arbitrary<PlanSlot> = fc.record({
  id: idArb.map(makePlanSlotId),
  date: isoDateArb,
  slotType: MEAL_TAG_ARB,
  slotIndex: fc.integer({ min: 0, max: 10 }),
  filling: fillingArb,
  state: fc.constantFrom<PlanSlotState>("planned", "cooked", "skipped"),
  pinned: fc.boolean(),
});

describe("PlanSlot codec", () => {
  it("encode -> decode is identity for every filling kind", () => {
    fc.assert(
      fc.property(planSlotArb, (slot) => {
        expect(decodePlanSlot(encodePlanSlot(slot))).toEqual(slot);
      }),
    );
  });
});

// --- InventoryEvents ---------------------------------------------------------

function timestampAt(secondOffset: number): IsoTimestamp {
  return makeIsoTimestamp(new Date(BASE_UTC + secondOffset * 1000).toISOString());
}

const isoTimestampArb = fc.integer({ min: 0, max: 200_000 }).map(timestampAt);
const positiveAmountArb = fc.integer({ min: 1, max: 100_000 });

const purchaseEventArb = fc
  .record({
    id: idArb.map(makeEventId),
    timestamp: isoTimestampArb,
    ingredientId: idArb.map(makeIngredientId),
    lotId: idArb.map(makeLotId),
    amount: positiveAmountArb,
    unit: UNIT_ARB,
    location: LOCATION_ARB,
    purchaseDate: isoDateArb,
    expiryOverride: fc.option(isoDateArb, { nil: undefined }),
  })
  .map((e) => ({
    type: "purchase" as const,
    id: e.id,
    timestamp: e.timestamp,
    ingredientId: e.ingredientId,
    lotId: e.lotId,
    quantity: makeQuantity(e.amount, e.unit),
    location: e.location,
    purchaseDate: e.purchaseDate,
    ...(e.expiryOverride !== undefined ? { expiryOverride: e.expiryOverride } : {}),
  }));

const useEventArb = fc
  .record({
    id: idArb.map(makeEventId),
    timestamp: isoTimestampArb,
    ingredientId: idArb.map(makeIngredientId),
    amount: positiveAmountArb,
    unit: UNIT_ARB,
  })
  .map((e) => ({
    type: "use" as const,
    id: e.id,
    timestamp: e.timestamp,
    ingredientId: e.ingredientId,
    quantity: makeQuantity(e.amount, e.unit),
  }));

const spoilEventArb = fc
  .record({
    id: idArb.map(makeEventId),
    timestamp: isoTimestampArb,
    ingredientId: idArb.map(makeIngredientId),
    lotId: idArb.map(makeLotId),
    amount: positiveAmountArb,
    unit: UNIT_ARB,
  })
  .map((e) => ({
    type: "spoil" as const,
    id: e.id,
    timestamp: e.timestamp,
    ingredientId: e.ingredientId,
    lotId: e.lotId,
    quantity: makeQuantity(e.amount, e.unit),
  }));

const adjustEventArb = fc
  .record({
    id: idArb.map(makeEventId),
    timestamp: isoTimestampArb,
    ingredientId: idArb.map(makeIngredientId),
    lotId: idArb.map(makeLotId),
    deltaAmount: fc.option(fc.integer({ min: -100_000, max: 100_000 }), { nil: undefined }),
    deltaUnit: UNIT_ARB,
    expiry: fc.option(isoDateArb, { nil: undefined }),
    reason: fc.option(fc.string({ minLength: 1, maxLength: 60 }), { nil: undefined }),
  })
  .filter((e) => e.deltaAmount !== undefined || e.expiry !== undefined)
  .map((e) =>
    makeAdjustEvent({
      id: e.id,
      timestamp: e.timestamp,
      ingredientId: e.ingredientId,
      lotId: e.lotId,
      ...(e.deltaAmount !== undefined ? { delta: makeQuantity(e.deltaAmount, e.deltaUnit) } : {}),
      ...(e.expiry !== undefined ? { expiry: e.expiry } : {}),
      ...(e.reason !== undefined ? { reason: e.reason } : {}),
    }),
  );

const moveEventArb = fc.record({
  type: fc.constant("move" as const),
  id: idArb.map(makeEventId),
  timestamp: isoTimestampArb,
  ingredientId: idArb.map(makeIngredientId),
  lotId: idArb.map(makeLotId),
  location: LOCATION_ARB,
});

const openEventArb = fc.record({
  type: fc.constant("open" as const),
  id: idArb.map(makeEventId),
  timestamp: isoTimestampArb,
  ingredientId: idArb.map(makeIngredientId),
  lotId: idArb.map(makeLotId),
});

const inventoryEventArb = fc.oneof(
  purchaseEventArb,
  useEventArb,
  spoilEventArb,
  adjustEventArb,
  moveEventArb,
  openEventArb,
);

describe("InventoryEvent codec", () => {
  it("encode -> decode is identity for every event variant (purchase/use/spoil/adjust/move/open)", () => {
    fc.assert(
      fc.property(inventoryEventArb, (event) => {
        expect(decodeInventoryEvent(encodeInventoryEvent(event))).toEqual(event);
      }),
    );
  });
});

// --- ShoppingItems ------------------------------------------------------------

const shoppingItemArb: fc.Arbitrary<ShoppingItem> = fc
  .record({
    ingredientId: idArb.map(makeIngredientId),
    rangeStartOffset: fc.integer({ min: 0, max: 1000 }),
    rangeSpan: fc.integer({ min: 0, max: 30 }),
    neededAmount: fc.integer({ min: 1, max: 100_000 }),
    neededUnit: UNIT_ARB,
    checked: fc.boolean(),
    bought: fc.option(fc.record({ amount: fc.integer({ min: 1, max: 100_000 }), unit: UNIT_ARB }), { nil: undefined }),
  })
  .map((s) => ({
    ingredientId: s.ingredientId,
    rangeStart: isoDateAt(s.rangeStartOffset),
    rangeEnd: isoDateAt(s.rangeStartOffset + s.rangeSpan),
    neededQuantity: makeQuantity(s.neededAmount, s.neededUnit),
    checked: s.checked,
    ...(s.bought !== undefined ? { boughtQuantity: makeQuantity(s.bought.amount, s.bought.unit) } : {}),
  }));

describe("ShoppingItem codec", () => {
  it("encode -> decode is identity", () => {
    fc.assert(
      fc.property(shoppingItemArb, (item) => {
        expect(decodeShoppingItem(encodeShoppingItem(item))).toEqual(item);
      }),
    );
  });
});

// --- Meta -----------------------------------------------------------------

const metaArb = fc.record({
  schemaVersion: fc.integer({ min: 1, max: 100 }),
  generation: fc.integer({ min: 1, max: 100_000 }),
});

describe("Meta codec", () => {
  it("encode -> decode is identity", () => {
    fc.assert(
      fc.property(metaArb, (meta) => {
        expect(decodeMeta(encodeMeta(meta))).toEqual(meta);
      }),
    );
  });
});

// --- Settings ---------------------------------------------------------------
//
// Every DaySlotLayout entry is given at least one slot: a day configured
// with zero slots is indistinguishable, once encoded, from that day simply
// not appearing in the layout at all (no "slot" rows are written for it —
// see settings.ts's decodeSettings), so round-trip identity is only
// meaningful for the realistic "every configured day has >=1 slot" case.

const slotLayoutArb: fc.Arbitrary<Settings["slotLayout"]> = fc.subarray([...WEEKDAYS]).chain((days) =>
  fc
    .array(fc.array(MEAL_TAG_ARB, { minLength: 1, maxLength: 4 }), {
      minLength: days.length,
      maxLength: days.length,
    })
    .map((slotsPerDay) => days.map((day, i) => ({ day, slots: slotsPerDay[i] ?? [] }))),
);

const settingsArb: fc.Arbitrary<Settings> = fc.record({
  householdSize: fc.integer({ min: 1, max: 12 }),
  slotLayout: slotLayoutArb,
  repeatExclusionWeeks: fc.integer({ min: 0, max: 12 }),
});

describe("Settings codec", () => {
  it("encode -> decode is identity", () => {
    fc.assert(
      fc.property(settingsArb, (settings) => {
        expect(decodeSettings(encodeSettings(settings))).toEqual(settings);
      }),
    );
  });
});

