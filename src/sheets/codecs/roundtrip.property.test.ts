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
  makeBarcode,
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makePlanSlotId,
  makePriceObservationId,
  makeQuantity,
  makeRecipeId,
  makeStepId,
  type EntryUnit,
  type Ingredient,
  type IngredientCategory,
  type IsoDate,
  type IsoTimestamp,
  type MealTag,
  type Photo,
  type PlanSlot,
  type PlanSlotFilling,
  type PlanSlotState,
  type PriceObservation,
  type Product,
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
  decodePhoto,
  decodePlanSlot,
  decodePriceObservation,
  decodeProduct,
  decodeRecipe,
  decodeRecipeIngredient,
  decodeRecipeStep,
  decodeSettings,
  decodeShoppingItem,
  encodeIngredient,
  encodeInventoryEvent,
  encodeMeta,
  encodePhoto,
  encodePlanSlot,
  encodePriceObservation,
  encodeProduct,
  encodeRecipe,
  encodeRecipeIngredient,
  encodeRecipeStep,
  encodeSettings,
  encodeShoppingItem,
  ENTRY_UNITS,
  INGREDIENT_CATEGORIES,
  legacyStepId,
  MAX_PHOTO_DATA_URL_LENGTH,
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

const CATEGORY_ARB = fc.constantFrom<IngredientCategory>(...INGREDIENT_CATEGORIES);

// WP-PURCHASING — pack size shares the ingredient's OWN unit (decodeIngredient
// drops a mismatch, see ingredients.test.ts), so it's generated from `unit`
// rather than independently.
const ingredientArb: fc.Arbitrary<Ingredient> = fc
  .record({
    id: idArb.map(makeIngredientId),
    name: fc.string({ minLength: 1, maxLength: 40 }),
    unit: UNIT_ARB,
    shelfLifeDays: fc.integer({ min: 0, max: 5000 }),
    openedShelfLifeDays: fc.integer({ min: 0, max: 5000 }),
    defaultLocation: LOCATION_ARB,
    // WP-VC3 — optional, like Settings.currency; unlike currency, a blank
    // cell decodes back to undefined (no default substituted), so
    // round-trip identity holds whether or not this is present.
    category: fc.option(CATEGORY_ARB, { nil: undefined }),
    purchaseMode: fc.option(fc.constantFrom<"whole" | "loose">("whole", "loose"), { nil: undefined }),
    packSizeAmount: fc.option(fc.integer({ min: 1, max: 10_000 }), { nil: undefined }),
    roundTo: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
    gramsPerMl: fc.option(fc.float({ min: Math.fround(0.01), max: 5, noNaN: true }), { nil: undefined }),
    gramsPerPiece: fc.option(fc.integer({ min: 1, max: 5000 }), { nil: undefined }),
  })
  .map(({ category, purchaseMode, packSizeAmount, roundTo, gramsPerMl, gramsPerPiece, unit, ...rest }) => ({
    ...rest,
    unit,
    ...(category !== undefined ? { category } : {}),
    ...(purchaseMode !== undefined ? { purchaseMode } : {}),
    ...(packSizeAmount !== undefined ? { packSize: makeQuantity(packSizeAmount, unit) } : {}),
    ...(roundTo !== undefined ? { roundTo } : {}),
    ...(gramsPerMl !== undefined ? { gramsPerMl } : {}),
    ...(gramsPerPiece !== undefined ? { gramsPerPiece } : {}),
  }));

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
  // WP-PURCHASING — optional, like has_photo.
  indivisible: fc.option(fc.boolean(), { nil: undefined }),
});

const recipeArb: fc.Arbitrary<Recipe> = recipeBaseArb.chain((base) => {
  const { indivisible, ...rest } = base;
  const prepMinutesArb = rest.kind === "bought" ? fc.constant(0) : fc.integer({ min: 0, max: 180 });
  return prepMinutesArb.map((prepMinutes) => ({
    ...rest,
    prepMinutes,
    ...(indivisible !== undefined ? { indivisible } : {}),
  }));
});

describe("Recipe codec", () => {
  it("encode -> decode is identity", () => {
    fc.assert(
      fc.property(recipeArb, (recipe) => {
        expect(decodeRecipe(encodeRecipe(recipe))).toEqual(recipe);
      }),
    );
  });

  it("WP-PURCHASING: a legacy row with no indivisible cell decodes it to undefined", () => {
    // Pre-WP-PURCHASING shape: nine cells (through has_photo).
    const legacyRow = ["chili", "Chili", "cooked", 4, 15, 30, "dinner", "in-rotation", ""];
    const decoded = decodeRecipe(legacyRow);
    expect(decoded.indivisible).toBeUndefined();
  });
});

// --- RecipeIngredients ------------------------------------------------------

const recipeIngredientArb: fc.Arbitrary<RecipeIngredient> = fc
  .record({
    recipeId: idArb.map(makeRecipeId),
    ingredientId: idArb.map(makeIngredientId),
    amount: fc.integer({ min: 1, max: 100_000 }),
    unit: UNIT_ARB,
    // WP-PURCHASING — provenance-only display pair, optional.
    displayQuantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
    displayUnit: fc.option(fc.constantFrom<EntryUnit>(...ENTRY_UNITS), { nil: undefined }),
  })
  .map(({ recipeId, ingredientId, amount, unit, displayQuantity, displayUnit }) => ({
    recipeId,
    ingredientId,
    quantity: makeQuantity(amount, unit),
    ...(displayQuantity !== undefined ? { displayQuantity } : {}),
    ...(displayUnit !== undefined ? { displayUnit } : {}),
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

  it("WP-PURCHASING: a legacy row with no display columns decodes displayQuantity/displayUnit to undefined", () => {
    // Pre-WP-PURCHASING shape: four cells.
    const legacyRow = ["chili", "mince", 450, "g"];
    const decoded = decodeRecipeIngredient(legacyRow, () => "g");
    expect(decoded.displayQuantity).toBeUndefined();
    expect(decoded.displayUnit).toBeUndefined();
    expect(decoded.quantity).toEqual(makeQuantity(450, "g"));
  });
});

// --- RecipeSteps ------------------------------------------------------------

const recipeStepArb: fc.Arbitrary<RecipeStep> = fc
  .record({
    recipeId: idArb.map(makeRecipeId),
    id: idArb.map(makeStepId),
    stepNumber: fc.integer({ min: 1, max: 50 }),
    description: fc.string({ minLength: 1, maxLength: 200 }),
    detail: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
    durationMinutes: fc.option(fc.integer({ min: 0, max: 600 }), { nil: undefined }),
    hasPhoto: fc.option(fc.boolean(), { nil: undefined }),
  })
  .map(({ detail, durationMinutes, hasPhoto, ...rest }) => ({
    ...rest,
    ...(detail !== undefined ? { detail } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    ...(hasPhoto !== undefined ? { hasPhoto } : {}),
  }));

describe("RecipeStep codec", () => {
  it("encode -> decode is identity", () => {
    fc.assert(
      fc.property(recipeStepArb, (step) => {
        expect(decodeRecipeStep(encodeRecipeStep(step))).toEqual(step);
      }),
    );
  });

  it("a legacy row with no id cell decodes deterministically from (recipe_id, step_number), not a quarantined row", () => {
    const recipeId = makeRecipeId("legacy-recipe");
    const legacyRow = [recipeId, 2, "Simmer for 45 minutes."]; // pre-WP-PHOTO shape: recipe_id, step_number, text
    const decoded = decodeRecipeStep(legacyRow);
    expect(decoded.id).toBe(legacyStepId(recipeId, 2));
    expect(decoded.description).toBe("Simmer for 45 minutes.");
    // Re-decoding the exact same row must mint the SAME id every time —
    // determinism is the whole point (see recipe-steps.ts's doc comment).
    expect(decodeRecipeStep(legacyRow).id).toBe(decoded.id);
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

const leftoverProjectedFillingArb: fc.Arbitrary<PlanSlotFilling> = fc
  .record({ sourceSlotId: idArb.map(makePlanSlotId), recipeId: idArb.map(makeRecipeId) })
  .map(({ sourceSlotId, recipeId }) => ({ kind: "leftover-projected" as const, sourceSlotId, recipeId }));

const emptyFillingArb: fc.Arbitrary<PlanSlotFilling> = fc.constant({ kind: "empty" as const });

const fillingArb: fc.Arbitrary<PlanSlotFilling> = fc.oneof(
  recipeFillingArb,
  leftoverFillingArb,
  leftoverProjectedFillingArb,
  emptyFillingArb,
);

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
    // WP-PURCHASING — optional, like boughtQuantity.
    suggested: fc.option(fc.record({ amount: fc.integer({ min: 1, max: 100_000 }), unit: UNIT_ARB }), { nil: undefined }),
    override: fc.option(fc.record({ amount: fc.integer({ min: 1, max: 100_000 }), unit: UNIT_ARB }), { nil: undefined }),
  })
  .map((s) => ({
    ingredientId: s.ingredientId,
    rangeStart: isoDateAt(s.rangeStartOffset),
    rangeEnd: isoDateAt(s.rangeStartOffset + s.rangeSpan),
    neededQuantity: makeQuantity(s.neededAmount, s.neededUnit),
    checked: s.checked,
    ...(s.bought !== undefined ? { boughtQuantity: makeQuantity(s.bought.amount, s.bought.unit) } : {}),
    ...(s.suggested !== undefined ? { suggestedPurchase: makeQuantity(s.suggested.amount, s.suggested.unit) } : {}),
    ...(s.override !== undefined ? { purchaseOverride: makeQuantity(s.override.amount, s.override.unit) } : {}),
  }));

describe("ShoppingItem codec", () => {
  it("encode -> decode is identity", () => {
    fc.assert(
      fc.property(shoppingItemArb, (item) => {
        expect(decodeShoppingItem(encodeShoppingItem(item))).toEqual(item);
      }),
    );
  });

  it("WP-PURCHASING: a legacy row with no suggested/override columns decodes both to undefined", () => {
    // Pre-WP-PURCHASING shape: eight cells (through bought_unit).
    const legacyRow = ["tomato", "2026-08-24", "2026-08-30", 200, "g", true, 500, "g"];
    const decoded = decodeShoppingItem(legacyRow);
    expect(decoded.suggestedPurchase).toBeUndefined();
    expect(decoded.purchaseOverride).toBeUndefined();
    expect(decoded.boughtQuantity).toEqual(makeQuantity(500, "g"));
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
  // Always defined here (never fc.option'd to `undefined`): decodeSettings
  // always returns a concrete currency (defaulting blank to "$"), so
  // round-trip identity only holds when the input already has one. The
  // "blank cell defaults to $" behaviour is covered separately in
  // settings.test.ts / bootstrap.test.ts, not as a round-trip property here.
  currency: fc.string({ minLength: 1, maxLength: 3 }),
  // Same reasoning as currency above (WP-leftover-planning): decodeSettings
  // always returns a concrete reuseGapSlots (defaulting blank to
  // DEFAULT_REUSE_GAP_SLOTS), so round-trip identity only holds when the
  // input already has one.
  reuseGapSlots: fc.integer({ min: 0, max: 10 }),
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

// --- Products -----------------------------------------------------------------

const BARCODE_ARB = fc
  .integer({ min: 100_000, max: 99_999_999_999_999 })
  .map((n) => makeBarcode(String(n)));

const ENTRY_UNIT_ARB = fc.constantFrom<EntryUnit>(...ENTRY_UNITS);

const productArb: fc.Arbitrary<Product> = fc
  .record({
    barcode: BARCODE_ARB,
    name: fc.string({ minLength: 1, maxLength: 40 }),
    brand: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
    ingredientId: idArb.map(makeIngredientId),
    canonicalAmount: fc.integer({ min: 1, max: 100_000 }),
    canonicalUnit: UNIT_ARB,
    displayQuantity: fc.integer({ min: 1, max: 1000 }),
    displayUnit: ENTRY_UNIT_ARB,
    shelfLifeDays: fc.integer({ min: 0, max: 5000 }),
    isBulk: fc.boolean(),
    hasPhoto: fc.boolean(),
  })
  .map((p) => ({
    barcode: p.barcode,
    name: p.name,
    ...(p.brand !== undefined ? { brand: p.brand } : {}),
    ingredientId: p.ingredientId,
    canonicalQuantity: makeQuantity(p.canonicalAmount, p.canonicalUnit),
    displayQuantity: p.displayQuantity,
    displayUnit: p.displayUnit,
    shelfLifeDays: p.shelfLifeDays,
    isBulk: p.isBulk,
    hasPhoto: p.hasPhoto,
  }));

describe("Product codec", () => {
  it("encode -> decode is identity", () => {
    fc.assert(
      fc.property(productArb, (product) => {
        expect(decodeProduct(encodeProduct(product))).toEqual(product);
      }),
    );
  });
});

// --- Photos --------------------------------------------------------------

// One owner-id arbitrary per PhotoOwnerKind, paired so decodePhoto always
// reconstructs the correctly-branded ownerId for whichever ownerKind comes
// out of the same record (WP-PHOTO — DESIGN_PHOTOS.md §2).
const ownedIdArb = fc.oneof(
  idArb.map(makeRecipeId).map((ownerId) => ({ ownerKind: "recipe" as const, ownerId })),
  idArb.map(makeStepId).map((ownerId) => ({ ownerKind: "recipe-step" as const, ownerId })),
  idArb.map(makeIngredientId).map((ownerId) => ({ ownerKind: "ingredient" as const, ownerId })),
  BARCODE_ARB.map((ownerId) => ({ ownerKind: "product" as const, ownerId })),
);

// Comfortably under the 50,000-char cell ceiling (DESIGN_PHOTOS.md §4) —
// the oversized case is covered by its own rejection test below, not the
// round-trip property.
const photoArb: fc.Arbitrary<Photo> = fc
  .record({
    owned: ownedIdArb,
    // Not real base64 — the codec has no opinion on data-URL contents beyond
    // length, so an arbitrary printable string exercises the round trip just
    // as well without pulling in a Buffer/base64 dependency here.
    dataUrl: fc.string({ minLength: 1, maxLength: 500 }).map((s) => `data:image/webp;base64,${s}`),
    updatedAt: isoTimestampArb,
  })
  .map(({ owned, dataUrl, updatedAt }) => ({ ownerKind: owned.ownerKind, ownerId: owned.ownerId, dataUrl, updatedAt }));

describe("Photo codec", () => {
  it("encode -> decode is identity for every owner kind", () => {
    fc.assert(
      fc.property(photoArb, (photo) => {
        expect(decodePhoto(encodePhoto(photo))).toEqual(photo);
      }),
    );
  });

  it("refuses to encode a data URL over the 50,000-character Sheets cell limit rather than truncating it", () => {
    const oversized: Photo = {
      ownerKind: "product",
      ownerId: makeBarcode("8001120000123"),
      dataUrl: `data:image/webp;base64,${"A".repeat(MAX_PHOTO_DATA_URL_LENGTH)}`,
      updatedAt: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    };
    expect(oversized.dataUrl.length).toBeGreaterThan(MAX_PHOTO_DATA_URL_LENGTH);
    expect(() => encodePhoto(oversized)).toThrow(/50,000-character|Google Sheets cell limit/);
    // Confirms this is a hard refusal, not silent truncation: nothing
    // shorter than the original was ever produced to compare against.
  });

  it("accepts a data URL exactly at the 50,000-character limit", () => {
    const atLimit: Photo = {
      ownerKind: "product",
      ownerId: makeBarcode("8001120000123"),
      dataUrl: "A".repeat(MAX_PHOTO_DATA_URL_LENGTH),
      updatedAt: makeIsoTimestamp("2026-03-01T09:00:00Z"),
    };
    expect(() => encodePhoto(atLimit)).not.toThrow();
    expect(decodePhoto(encodePhoto(atLimit))).toEqual(atLimit);
  });
});

// --- PriceObservations ------------------------------------------------------

const priceObservationArb: fc.Arbitrary<PriceObservation> = fc
  .record({
    id: idArb.map(makePriceObservationId),
    timestamp: isoTimestampArb,
    barcode: fc.option(BARCODE_ARB, { nil: undefined }),
    ingredientId: idArb.map(makeIngredientId),
    amount: fc.integer({ min: 1, max: 100_000 }),
    unit: UNIT_ARB,
    price: fc.float({ min: 0, max: 10_000, noNaN: true }),
    source: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
  })
  .map((o) => ({
    id: o.id,
    timestamp: o.timestamp,
    ...(o.barcode !== undefined ? { barcode: o.barcode } : {}),
    ingredientId: o.ingredientId,
    quantity: makeQuantity(o.amount, o.unit),
    price: o.price,
    ...(o.source !== undefined ? { source: o.source } : {}),
  }));

describe("PriceObservation codec", () => {
  it("encode -> decode is identity, with and without a barcode/source", () => {
    fc.assert(
      fc.property(priceObservationArb, (observation) => {
        expect(decodePriceObservation(encodePriceObservation(observation))).toEqual(observation);
      }),
    );
  });

  it("never encodes a currency column (single household currency lives in Settings, not per-row)", () => {
    fc.assert(
      fc.property(priceObservationArb, (observation) => {
        expect(encodePriceObservation(observation)).toHaveLength(8);
      }),
    );
  });
});

