import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { ToastProvider } from "../../ui/components/Toast/ToastProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../../domain/fakes/index.ts";
import {
  makeBarcode,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makePriceObservationId,
  makeProductId,
  makeQuantity,
  type Ingredient,
  type PriceObservation,
  type Product,
  type ProductBarcode,
  type WorkbookStore,
} from "../../domain/index.ts";
import { useProductsData } from "./useProductsData.ts";

const TOMATO = makeIngredientId("tomato");
const KEEP_ID = makeProductId("product-keep");
const DROP_ID = makeProductId("product-drop");
const KEEP_BARCODE = makeBarcode("1111111111");
const DROP_BARCODE = makeBarcode("2222222222");

const INGREDIENTS: readonly Ingredient[] = [
  { id: TOMATO, name: "Tomato", unit: "piece", shelfLifeDays: 10, openedShelfLifeDays: 5, defaultLocation: "pantry" },
];

const PRODUCTS: readonly Product[] = [
  {
    id: KEEP_ID,
    name: "Tomatoes, tinned",
    ingredientId: TOMATO,
    canonicalQuantity: makeQuantity(400, "g"),
    displayQuantity: 400,
    displayUnit: "g",
    shelfLifeDays: 365,
    isBulk: false,
    hasPhoto: false,
  },
  {
    id: DROP_ID,
    name: "Tinned Tomatoes",
    ingredientId: TOMATO,
    canonicalQuantity: makeQuantity(400, "g"),
    displayQuantity: 400,
    displayUnit: "g",
    shelfLifeDays: 365,
    isBulk: false,
    hasPhoto: false,
  },
];

const BARCODE_ROWS: readonly ProductBarcode[] = [
  { productId: KEEP_ID, barcode: KEEP_BARCODE },
  { productId: DROP_ID, barcode: DROP_BARCODE },
];

const OBSERVATIONS: readonly PriceObservation[] = [
  {
    id: makePriceObservationId("obs-keep"),
    timestamp: makeIsoTimestamp("2026-08-01T10:00:00.000Z"),
    barcode: KEEP_BARCODE,
    ingredientId: TOMATO,
    quantity: makeQuantity(400, "g"),
    price: 1.5,
  },
  {
    id: makePriceObservationId("obs-drop"),
    timestamp: makeIsoTimestamp("2026-08-05T10:00:00.000Z"),
    barcode: DROP_BARCODE,
    ingredientId: TOMATO,
    quantity: makeQuantity(400, "g"),
    price: 1.6,
  },
];

async function seed(store: WorkbookStore): Promise<void> {
  for (const ingredient of INGREDIENTS) await store.ingredients.upsert(ingredient);
  for (const product of PRODUCTS) await store.products.upsert(product);
  for (const row of BARCODE_ROWS) await store.productBarcodes.upsert(row);
  for (const observation of OBSERVATIONS) await store.priceObservations.append(observation);
}

function wrapperFor(store: WorkbookStore): ({ children }: { readonly children: ReactNode }) => ReactElement {
  const contextValue: WorkbookContextValue = {
    store,
    clock: createFixedClock(makeIsoTimestamp("2026-08-23T18:00:00.000Z"), makeIsoDate("2026-08-23")),
    rng: createFakeRng(1),
    workbookId: "wb-1",
    outbox: createFakeOutbox(),
  };
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <WorkbookContext.Provider value={contextValue}>
        <ToastProvider>{children}</ToastProvider>
      </WorkbookContext.Provider>
    );
  };
}

/**
 * WP-products-screen follow-up: a confirmed merge must make the "losing"
 * product actually disappear from the browse list, not just reassign its
 * barcodes/history and leave a zero-barcode ghost row behind — see this
 * package's own gap disclosure in the handover. Asserts the outcome a person
 * would notice (one product left, both price observations still reachable
 * on the survivor), not the sequence of calls that produced it.
 */
describe("useProductsData — confirmMerge removes the losing product", () => {
  it("leaves exactly one product in the browse list, with both products' price observations reachable on the survivor", async () => {
    const store = createFakeWorkbookStore();
    await seed(store);

    const { result } = renderHook(() => useProductsData(), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.confirmMerge(KEEP_ID, DROP_ID);

    await waitFor(() => expect(result.current.products.map((p) => p.id)).toEqual([KEEP_ID]));

    // Not just local state — the underlying store agrees, which is what the
    // browse list actually re-reads from on reload.
    const storedProducts = (await store.products.readAll()).rows;
    expect(storedProducts.map((p) => p.id)).toEqual([KEEP_ID]);

    const barcodesForKeep = result.current.barcodesByProduct.get(KEEP_ID) ?? [];
    expect(new Set(barcodesForKeep)).toEqual(new Set([KEEP_BARCODE, DROP_BARCODE]));

    // Both original price observations are still reachable by resolving
    // their barcode to a product — nothing in InventoryEvents/PriceObservations
    // was rewritten (invariant 1), only the barcode->product lookup moved.
    const barcodeToProduct = new Map(result.current.productBarcodes.map((row) => [row.barcode, row.productId] as const));
    for (const observation of result.current.observations) {
      const owner = observation.barcode ? barcodeToProduct.get(observation.barcode) : undefined;
      expect(owner).toBe(KEEP_ID);
    }
    expect(result.current.observations).toHaveLength(2);
  });
});
