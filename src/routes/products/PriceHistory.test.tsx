import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { PriceHistory } from "./PriceHistory.tsx";
import { ToastProvider } from "../../ui/components/Toast/ToastProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../../domain/fakes/index.ts";
import {
  makeBarcode,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makePriceObservationId,
  makeQuantity,
  type Ingredient,
  type PriceObservation,
  type Product,
  type WorkbookStore,
} from "../../domain/index.ts";

function renderPriceHistory(store: WorkbookStore, initialPath = "/products/prices") {
  const contextValue: WorkbookContextValue = {
    store,
    clock: createFixedClock(makeIsoTimestamp("2026-08-21T12:00:00.000Z"), makeIsoDate("2026-08-21")),
    rng: createFakeRng(1),
    workbookId: "wb-1",
    outbox: createFakeOutbox(),
  };
  const router = createMemoryRouter(
    [
      { path: "/products/prices", element: <PriceHistory /> },
      { path: "/products/prices/ingredient/:ingredientId", element: <p>Ingredient detail</p> },
      { path: "/products/prices/product/:barcode", element: <p>Product detail</p> },
      { path: "/scan", element: <p>Scan</p> },
    ],
    { initialEntries: [initialPath] },
  );
  return render(
    <WorkbookContext.Provider value={contextValue}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </WorkbookContext.Provider>,
  );
}

const RICE_ID = makeIngredientId("rice");
const rice: Ingredient = {
  id: RICE_ID,
  name: "Rice",
  unit: "g",
  shelfLifeDays: 365,
  openedShelfLifeDays: 90,
  defaultLocation: "pantry",
};

describe("PriceHistory — zero observations (day-one case)", () => {
  it("shows a real empty state, not a blank or broken-looking list", async () => {
    renderPriceHistory(createFakeWorkbookStore());

    expect(await screen.findByText("No prices recorded yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scan a barcode" })).toBeInTheDocument();
    // No level toggle when there's nothing to group at all.
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});

describe("PriceHistory — a single observation", () => {
  it("shows the ingredient with a 'New' badge rather than a fabricated trend", async () => {
    const store = createFakeWorkbookStore();
    await store.ingredients.upsert(rice);
    const observation: PriceObservation = {
      id: makePriceObservationId("obs-1"),
      timestamp: makeIsoTimestamp("2026-08-10T09:00:00.000Z"),
      ingredientId: RICE_ID,
      quantity: makeQuantity(1000, "g"),
      price: 2.4,
    };
    await store.priceObservations.append(observation);

    renderPriceHistory(store);

    expect(await screen.findByText("Rice")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText(/\$0\.24 per 100 g · 1 observation/)).toBeInTheDocument();
  });
});

describe("PriceHistory — currency", () => {
  it("formats prices using Settings.currency, never a hardcoded symbol", async () => {
    const store = createFakeWorkbookStore();
    await store.ingredients.upsert(rice);
    await store.settings.write({
      householdSize: 2,
      slotLayout: [],
      repeatExclusionWeeks: 3,
      currency: "€",
    });
    await store.priceObservations.append({
      id: makePriceObservationId("obs-1"),
      timestamp: makeIsoTimestamp("2026-08-10T09:00:00.000Z"),
      ingredientId: RICE_ID,
      quantity: makeQuantity(1000, "g"),
      price: 2.4,
    });

    renderPriceHistory(store);

    expect(await screen.findByText(/€0\.24 per 100 g/)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.24/)).not.toBeInTheDocument();
  });

  it("defaults to '$' when the workbook has no Settings row yet", async () => {
    const store = createFakeWorkbookStore();
    const broken: WorkbookStore = {
      ...store,
      settings: {
        read: () => Promise.reject(new Error("no settings row")),
        write: store.settings.write,
      },
    };
    await broken.ingredients.upsert(rice);
    await broken.priceObservations.append({
      id: makePriceObservationId("obs-1"),
      timestamp: makeIsoTimestamp("2026-08-10T09:00:00.000Z"),
      ingredientId: RICE_ID,
      quantity: makeQuantity(1000, "g"),
      price: 2.4,
    });

    renderPriceHistory(broken);

    // A broken Settings row must not block this read-only view.
    expect(await screen.findByText(/\$0\.24 per 100 g/)).toBeInTheDocument();
  });
});

describe("PriceHistory — two levels (DESIGN_PRODUCTS.md §1.4)", () => {
  it("shows both an ingredient-level row and a distinct product-level row for the same underlying data", async () => {
    const store = createFakeWorkbookStore();
    const barcode = makeBarcode("8001120000123");
    await store.ingredients.upsert(rice);
    const product: Product = {
      barcode,
      name: "Riso Gallo Arborio",
      ingredientId: RICE_ID,
      canonicalQuantity: makeQuantity(1000, "g"),
      displayQuantity: 1,
      displayUnit: "kg",
      shelfLifeDays: 730,
      isBulk: false,
      hasPhoto: false,
    };
    await store.products.upsert(product);
    await store.priceObservations.append({
      id: makePriceObservationId("obs-1"),
      timestamp: makeIsoTimestamp("2026-08-01T09:00:00.000Z"),
      ingredientId: RICE_ID,
      quantity: makeQuantity(1000, "g"),
      price: 2.0,
      barcode,
    });
    await store.priceObservations.append({
      id: makePriceObservationId("obs-2"),
      timestamp: makeIsoTimestamp("2026-08-15T09:00:00.000Z"),
      ingredientId: RICE_ID,
      quantity: makeQuantity(1000, "g"),
      price: 2.4,
      barcode,
    });

    renderPriceHistory(store);

    // Default level: ingredient.
    expect(await screen.findByText("Rice")).toBeInTheDocument();
    expect(screen.getByText(/2 observations/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "By product" }));

    expect(await screen.findByText("Riso Gallo Arborio")).toBeInTheDocument();
    // A rise from $2.00 to $2.40/100g is +20%.
    expect(screen.getByText(/▲ 20\.0%/)).toBeInTheDocument();
  });

  it("shows a thin-data empty state for the product level when only bare-ingredient prices exist", async () => {
    const store = createFakeWorkbookStore();
    await store.ingredients.upsert(rice);
    await store.priceObservations.append({
      id: makePriceObservationId("obs-1"),
      timestamp: makeIsoTimestamp("2026-08-01T09:00:00.000Z"),
      ingredientId: RICE_ID,
      quantity: makeQuantity(1000, "g"),
      price: 2.0,
    });

    renderPriceHistory(store);
    expect(await screen.findByText("Rice")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "By product" }));

    expect(await screen.findByText("No product-level prices yet")).toBeInTheDocument();
  });
});
