/**
 * I/O-level proof of the WP-PRODUCTS-MODEL migration, over the same
 * `WorkbookStore` contract every other package tests against (the in-memory
 * fake) — the pure computation is unit-tested exhaustively in
 * src/domain/products.test.ts; this proves the wiring: a legacy workbook
 * (Products rows with no ProductBarcodes at all) opens and gets backfilled,
 * and running it again is a genuine no-op, not just "computes an empty
 * diff" but "makes zero additional store calls worth mentioning" — asserted
 * by re-running and diffing the full ProductBarcodes table, not by
 * inspecting a call count.
 */
import { describe, expect, it } from "vitest";
import { createFakeWorkbookStore } from "../domain/fakes/index.ts";
import { makeBarcode, makeIngredientId, makeProductId, makeQuantity, type Product } from "../domain/types.ts";
import { runProductBarcodeMigration } from "./product-barcode-migration.ts";

const TOMATO = makeIngredientId("tomato");

function legacyProduct(barcodeAsId: string, name: string): Product {
  return {
    id: makeProductId(barcodeAsId),
    name,
    ingredientId: TOMATO,
    canonicalQuantity: makeQuantity(500, "g"),
    displayQuantity: 500,
    displayUnit: "g",
    shelfLifeDays: 10,
    isBulk: false,
    hasPhoto: false,
  };
}

describe("runProductBarcodeMigration", () => {
  it("backfills a ProductBarcode row for every pre-re-key Products row on a legacy workbook", async () => {
    const store = createFakeWorkbookStore();
    // Simulates a workbook written before this re-key: Products rows exist,
    // ProductBarcodes does not (nothing has ever written to it).
    await store.products.upsert(legacyProduct("8001120000111", "Tomatoes (Shop A)"));
    await store.products.upsert(legacyProduct("8001120000222", "Tomatoes (Shop B)"));

    const result = await runProductBarcodeMigration(store);
    expect(result.written).toBe(2);
    expect(result.unresolvable).toBe(0);

    const { rows } = await store.productBarcodes.readAll();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.barcode))).toEqual(new Set(["8001120000111", "8001120000222"]));
    for (const row of rows) expect(row.productId).toBe(row.barcode);
  });

  it("running it a second time against its own result writes nothing further (idempotent)", async () => {
    const store = createFakeWorkbookStore();
    await store.products.upsert(legacyProduct("8001120000111", "Tomatoes (Shop A)"));

    const first = await runProductBarcodeMigration(store);
    expect(first.written).toBe(1);

    const afterFirst = (await store.productBarcodes.readAll()).rows;

    const second = await runProductBarcodeMigration(store);
    expect(second.written).toBe(0);

    const afterSecond = (await store.productBarcodes.readAll()).rows;
    expect(afterSecond).toEqual(afterFirst);
  });

  it("is a no-op (zero writes) on a workbook with no products at all, and on an already-migrated one", async () => {
    const empty = createFakeWorkbookStore();
    expect((await runProductBarcodeMigration(empty)).written).toBe(0);

    const migrated = createFakeWorkbookStore();
    const productId = makeProductId("a-fresh-random-id");
    await migrated.products.upsert({ ...legacyProduct("unused", "Tomatoes"), id: productId });
    await migrated.productBarcodes.upsert({ productId, barcode: makeBarcode("8001120000333") });
    expect((await runProductBarcodeMigration(migrated)).written).toBe(0);
  });

  it("never deletes or alters an existing ProductBarcodes row while backfilling others", async () => {
    const store = createFakeWorkbookStore();
    const freshId = makeProductId("fresh-id-not-barcode-shaped");
    await store.products.upsert({ ...legacyProduct("unused", "Fresh Product"), id: freshId });
    const existingBarcode = makeBarcode("8001120000999");
    await store.productBarcodes.upsert({ productId: freshId, barcode: existingBarcode });

    // A legacy product also present in the same workbook.
    await store.products.upsert(legacyProduct("8001120000111", "Tomatoes"));

    await runProductBarcodeMigration(store);

    const { rows } = await store.productBarcodes.readAll();
    const freshRow = rows.find((r) => r.productId === freshId);
    expect(freshRow?.barcode).toBe(existingBarcode);
    expect(rows).toHaveLength(2);
  });
});
