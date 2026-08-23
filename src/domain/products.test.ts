/**
 * WP-PRODUCTS-MODEL: the re-key's risk lives here, not in the UI. Asserts
 * the PROPERTIES the task brief calls for — idempotency, non-destructiveness,
 * "price history survives a merge" — rather than a call sequence, since this
 * project has previously shipped a test that passed on unfixed code because
 * it only asserted a final value.
 */
import { describe, expect, it } from "vitest";
import {
  makeBarcode,
  makeIngredientId,
  makeIsoTimestamp,
  makePriceObservationId,
  makeProductId,
  makeQuantity,
  type PriceObservation,
  type Product,
  type ProductBarcode,
} from "./types.ts";
import {
  barcodesForProduct,
  buildBarcodeIndex,
  migrateLegacyProductBarcodes,
  observationsForProduct,
  planProductMerge,
  resolveProductId,
  suggestProductMerges,
} from "./products.ts";

const TOMATO = makeIngredientId("tomato");
const RICE = makeIngredientId("rice");

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: makeProductId("prod-1"),
    name: "Tomatoes",
    ingredientId: TOMATO,
    canonicalQuantity: makeQuantity(500, "g"),
    displayQuantity: 500,
    displayUnit: "g",
    shelfLifeDays: 10,
    isBulk: false,
    hasPhoto: false,
    ...overrides,
  };
}

function observation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    id: makePriceObservationId("obs-1"),
    timestamp: makeIsoTimestamp("2026-08-01T09:00:00Z"),
    ingredientId: TOMATO,
    quantity: makeQuantity(500, "g"),
    price: 2.0,
    ...overrides,
  };
}

describe("buildBarcodeIndex / resolveProductId / barcodesForProduct", () => {
  const shopABarcode = makeBarcode("8001120000123");
  const shopBBarcode = makeBarcode("8001120000456");
  const productId = makeProductId("prod-1");
  const rows: readonly ProductBarcode[] = [
    { productId, barcode: shopABarcode },
    { productId, barcode: shopBBarcode },
  ];

  it("resolves either of a product's barcodes to the same product id", () => {
    expect(resolveProductId(shopABarcode, rows)).toBe(productId);
    expect(resolveProductId(shopBBarcode, rows)).toBe(productId);
  });

  it("an unknown barcode resolves to undefined", () => {
    expect(resolveProductId(makeBarcode("8001120000789"), rows)).toBeUndefined();
  });

  it("barcodesForProduct returns every barcode owned by that product", () => {
    expect(barcodesForProduct(productId, rows)).toEqual([shopABarcode, shopBBarcode]);
  });

  it("buildBarcodeIndex maps every row", () => {
    const index = buildBarcodeIndex(rows);
    expect(index.get(shopABarcode)).toBe(productId);
    expect(index.get(shopBBarcode)).toBe(productId);
    expect(index.size).toBe(2);
  });
});

describe("observationsForProduct — price history rolls up through the barcode join, never by rewriting PriceObservation", () => {
  it("returns only observations naming a barcode this product currently owns", () => {
    const productId = makeProductId("prod-1");
    const ownedBarcode = makeBarcode("8001120000123");
    const otherBarcode = makeBarcode("8001120000456");
    const rows: readonly ProductBarcode[] = [{ productId, barcode: ownedBarcode }];
    const observations = [
      observation({ id: makePriceObservationId("a"), barcode: ownedBarcode }),
      observation({ id: makePriceObservationId("b"), barcode: otherBarcode }),
      observation({ id: makePriceObservationId("c") }), // no barcode at all
    ];
    const result = observationsForProduct(observations, productId, rows);
    expect(result.map((o) => o.id)).toEqual([makePriceObservationId("a")]);
  });
});

describe("migrateLegacyProductBarcodes", () => {
  it("gives every legacy (barcode-as-id) product a matching ProductBarcode row", () => {
    const legacyBarcode = makeBarcode("8001120000123");
    const legacyProduct = product({ id: makeProductId(legacyBarcode) });
    const { rowsToWrite, unresolvable } = migrateLegacyProductBarcodes([legacyProduct], []);
    expect(rowsToWrite).toEqual([{ productId: legacyProduct.id, barcode: legacyBarcode }]);
    expect(unresolvable).toEqual([]);
  });

  it("is idempotent: running it again against its own output computes nothing further to write", () => {
    const legacyBarcode = makeBarcode("8001120000123");
    const legacyProduct = product({ id: makeProductId(legacyBarcode) });
    const first = migrateLegacyProductBarcodes([legacyProduct], []);
    expect(first.rowsToWrite).toHaveLength(1);

    // Simulate the write having happened, then run again — the defining
    // "idempotent" property: a second pass, with the first pass's own
    // output now present, must be a genuine no-op.
    const second = migrateLegacyProductBarcodes([legacyProduct], first.rowsToWrite);
    expect(second.rowsToWrite).toEqual([]);
    expect(second.unresolvable).toEqual([]);
  });

  it("is non-destructive: never touches a product that already has a barcode row, even a DIFFERENT barcode than its own id", () => {
    // A product created post-re-key (a fresh ProductId, not barcode-shaped)
    // that already owns an unrelated barcode — migration must leave it
    // completely alone, not "fix" it to also own its own id as a barcode.
    const freshProduct = product({ id: makeProductId("a-fresh-random-id") });
    const existingRow: ProductBarcode = { productId: freshProduct.id, barcode: makeBarcode("8001120000999") };
    const result = migrateLegacyProductBarcodes([freshProduct], [existingRow]);
    expect(result.rowsToWrite).toEqual([]);
  });

  it("reports (never throws for) a product whose id doesn't parse as a barcode and has no existing row", () => {
    const freshProduct = product({ id: makeProductId("not-a-barcode-shaped-id") });
    const result = migrateLegacyProductBarcodes([freshProduct], []);
    expect(result.rowsToWrite).toEqual([]);
    expect(result.unresolvable).toEqual([freshProduct.id]);
  });

  it("running the migration twice over a mixed legacy + already-migrated + fresh workbook is a no-op on the second pass", () => {
    const legacyBarcode1 = makeBarcode("8001120000111");
    const legacyBarcode2 = makeBarcode("8001120000222");
    const legacy1 = product({ id: makeProductId(legacyBarcode1) });
    const legacy2 = product({ id: makeProductId(legacyBarcode2) });
    const freshId = makeProductId("fresh-id-not-barcode-shaped");
    const fresh = product({ id: freshId });
    const freshBarcodeRow: ProductBarcode = { productId: freshId, barcode: makeBarcode("8001120000333") };

    const products = [legacy1, legacy2, fresh];
    const firstPass = migrateLegacyProductBarcodes(products, [freshBarcodeRow]);
    expect(firstPass.rowsToWrite).toHaveLength(2); // only the two legacy ones

    const afterWrite = [freshBarcodeRow, ...firstPass.rowsToWrite];
    const secondPass = migrateLegacyProductBarcodes(products, afterWrite);
    expect(secondPass.rowsToWrite).toEqual([]);
  });
});

describe("suggestProductMerges — pure suggestions only, biased toward under-suggesting", () => {
  it("suggests two products with the same ingredient, same package size, and near-identical names", () => {
    const shopA = product({ id: makeProductId("shop-a-tomatoes"), name: "Tomatoes" });
    const shopB = product({ id: makeProductId("shop-b-tomatoes"), name: "Tomatoes" });
    const suggestions = suggestProductMerges([shopA, shopB]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.confidence).toBe("high");
    expect(new Set([suggestions[0]!.a.id, suggestions[0]!.b.id])).toEqual(new Set([shopA.id, shopB.id]));
  });

  it("does NOT suggest two products of different ingredients, even with identical names and sizes", () => {
    const a = product({ id: makeProductId("a"), name: "Milk", ingredientId: TOMATO });
    const b = product({ id: makeProductId("b"), name: "Milk", ingredientId: RICE });
    expect(suggestProductMerges([a, b])).toEqual([]);
  });

  it("does NOT suggest two products with different canonical package sizes", () => {
    const a = product({ id: makeProductId("a"), name: "Tomatoes", canonicalQuantity: makeQuantity(500, "g") });
    const b = product({ id: makeProductId("b"), name: "Tomatoes", canonicalQuantity: makeQuantity(1000, "g") });
    expect(suggestProductMerges([a, b])).toEqual([]);
  });

  it("does NOT suggest two same-ingredient, same-size products whose names don't actually overlap (avoids the confident-wrong-merge failure mode)", () => {
    const a = product({ id: makeProductId("a"), name: "Riso Gallo Arborio" });
    const b = product({ id: makeProductId("b"), name: "Store Brand Basmati" });
    expect(suggestProductMerges([a, b])).toEqual([]);
  });

  it("tolerates small float noise in canonical amount (e.g. unit-conversion rounding) within 2%", () => {
    const a = product({ id: makeProductId("a"), name: "Tomatoes", canonicalQuantity: makeQuantity(454, "g") });
    const b = product({ id: makeProductId("b"), name: "Tomatoes", canonicalQuantity: makeQuantity(453.59, "g") });
    expect(suggestProductMerges([a, b])).toHaveLength(1);
  });

  it("marks confidence 'medium' rather than 'high' when names overlap partially and brands differ/are absent", () => {
    const a = product({ id: makeProductId("a"), name: "Cherry Tomatoes Organic" });
    const b = product({ id: makeProductId("b"), name: "Cherry Tomatoes Value" });
    const suggestions = suggestProductMerges([a, b]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.confidence).toBe("medium");
  });

  it("never suggests a product against itself, and never suggests the same pair twice", () => {
    const a = product({ id: makeProductId("a"), name: "Tomatoes" });
    const b = product({ id: makeProductId("b"), name: "Tomatoes" });
    const c = product({ id: makeProductId("c"), name: "Tomatoes" });
    const suggestions = suggestProductMerges([a, b, c]);
    // 3 products, same bucket -> exactly 3 unordered pairs, never a self-pair.
    expect(suggestions).toHaveLength(3);
    for (const s of suggestions) expect(s.a.id).not.toBe(s.b.id);
  });
});

describe("planProductMerge — price history survives a merge without rewriting PriceObservations", () => {
  it("reassigns every barcode from both products to the surviving product id", () => {
    const keepId = makeProductId("keep");
    const dropId = makeProductId("drop");
    const keepBarcode = makeBarcode("8001120000111");
    const dropBarcode = makeBarcode("8001120000222");
    const rows: readonly ProductBarcode[] = [
      { productId: keepId, barcode: keepBarcode },
      { productId: dropId, barcode: dropBarcode },
    ];
    const plan = planProductMerge(keepId, dropId, rows, []);
    expect(plan.barcodeRows).toEqual(
      expect.arrayContaining([
        { productId: keepId, barcode: keepBarcode },
        { productId: keepId, barcode: dropBarcode },
      ]),
    );
    expect(plan.barcodeRows).toHaveLength(2);
  });

  it("every price observation naming either product's barcode is included in observationsToRollUp — nothing is orphaned", () => {
    const keepId = makeProductId("keep");
    const dropId = makeProductId("drop");
    const keepBarcode = makeBarcode("8001120000111");
    const dropBarcode = makeBarcode("8001120000222");
    const unrelatedBarcode = makeBarcode("8001120000333");
    const rows: readonly ProductBarcode[] = [
      { productId: keepId, barcode: keepBarcode },
      { productId: dropId, barcode: dropBarcode },
    ];
    const observations = [
      observation({ id: makePriceObservationId("a"), barcode: keepBarcode, price: 2.0 }),
      observation({ id: makePriceObservationId("b"), barcode: dropBarcode, price: 2.5 }),
      observation({ id: makePriceObservationId("c"), barcode: unrelatedBarcode, price: 9.99 }),
    ];
    const plan = planProductMerge(keepId, dropId, rows, observations);
    expect(plan.observationsToRollUp.map((o) => o.id).sort()).toEqual(["a", "b"]);

    // The load-bearing property: after writing plan.barcodeRows, resolving
    // EVERY pre-merge observation's barcode through the NEW rows recovers
    // the merged product for the ones that belong to it, with the
    // observation's own `barcode` field never rewritten.
    const afterMerge = plan.barcodeRows;
    for (const obs of [observations[0]!, observations[1]!]) {
      expect(resolveProductId(obs.barcode!, afterMerge)).toBe(keepId);
    }
    expect(resolveProductId(unrelatedBarcode, afterMerge)).toBeUndefined();
    // Observations are untouched — no barcode field was ever rewritten.
    expect(observations[0]!.barcode).toBe(keepBarcode);
    expect(observations[1]!.barcode).toBe(dropBarcode);
  });

  it("planning the identical merge twice produces the identical plan (idempotent)", () => {
    const keepId = makeProductId("keep");
    const dropId = makeProductId("drop");
    const rows: readonly ProductBarcode[] = [
      { productId: keepId, barcode: makeBarcode("8001120000111") },
      { productId: dropId, barcode: makeBarcode("8001120000222") },
    ];
    const first = planProductMerge(keepId, dropId, rows, []);
    // Simulate having applied the first plan, then plan again.
    const second = planProductMerge(keepId, dropId, first.barcodeRows, []);
    expect(second.barcodeRows).toEqual(first.barcodeRows);
  });
});
