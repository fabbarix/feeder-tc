import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import type { HttpHandler } from "msw";
import { expect } from "vitest";
import { createFakeSheetsTransport } from "../src/domain/fakes/index.ts";
import type { SheetsTransport, WorkbookStore } from "../src/domain/contracts.ts";
import { createGoogleAuth, type GoogleAuthDeps } from "../src/sheets/auth.ts";
import { bootstrapWorkbook, WORKBOOK_SHEET_NAMES } from "../src/sheets/bootstrap.ts";
import { INGREDIENTS_HEADER, WORKBOOK_HEADERS } from "../src/sheets/codecs/index.ts";
import { createSheetsApiHandlers, createSpreadsheetCreationHandler } from "../src/sheets/mocks/handlers.ts";
import { createWorkbookRegistry } from "../src/sheets/registry.ts";
import { createWorkbook } from "../src/sheets/spreadsheet.ts";
import { createGoogleSheetsTransport } from "../src/sheets/transport.ts";
import { createSheetsWorkbookStore } from "../src/sheets/workbook-store.ts";
import { server } from "../src/mocks/server.ts";

const feature = await loadFeature("./wp-11-workbook-bootstrap.feature");

let registryKeyCounter = 0;

describeFeature(feature, ({ Scenario }) => {
  Scenario("Creating a fresh workbook", ({ Given, When, Then, And }) => {
    const ACCESS_TOKEN = "wp11-bootstrap-token";
    let auth: ReturnType<typeof createGoogleAuth>;
    let registry: ReturnType<typeof createWorkbookRegistry>;
    let spreadsheetId: string;
    let transport: SheetsTransport;
    let store: WorkbookStore;
    // `createSheetsApiHandlers` closes over one in-memory fake spreadsheet
    // (see that function's header comment). msw resets handlers between
    // steps (src/mocks/vitest.setup.ts's afterEach), but each Given/When/
    // Then/And here is its own vitest `it()`, so later steps must
    // *re-register this same handler array* — not call
    // `createSheetsApiHandlers` again, which would hand back a second,
    // empty fake spreadsheet and silently lose everything the "When" step
    // wrote.
    let sheetsApiHandlers: HttpHandler[];

    Given("a signed-in user with no workbook", async () => {
      const deps: GoogleAuthDeps = {
        async createTokenClient(callback) {
          return {
            requestAccessToken() {
              queueMicrotask(() => callback({ access_token: ACCESS_TOKEN, expires_in: 3600 }));
            },
          };
        },
        async revoke() {},
        now: () => 0,
        readConsentHint: () => false,
        writeConsentHint() {},
        readStoredToken: () => undefined,
        writeStoredToken() {},
      };
      auth = createGoogleAuth("test-client-id", deps);
      await auth.signIn();
      expect(auth.state()).toBe("signed-in");

      registryKeyCounter += 1;
      registry = createWorkbookRegistry(localStorage, `feeder.workbookRegistry.wp11-${registryKeyCounter}`);
      expect(registry.getActive()).toBeUndefined();
    });

    When('they choose "Create new meal planner"', async () => {
      spreadsheetId = `wp11-bootstrap-sheet-${registryKeyCounter}`;
      sheetsApiHandlers = createSheetsApiHandlers({ spreadsheetId, accessToken: ACCESS_TOKEN });
      server.use(
        createSpreadsheetCreationHandler(ACCESS_TOKEN, (title) => ({ spreadsheetId, title })),
        ...sheetsApiHandlers,
      );

      const sheetsAuth = { getAccessToken: async () => ACCESS_TOKEN, invalidate: () => {} };
      await createWorkbook("Our Meal Planner", auth, registry);

      transport = createGoogleSheetsTransport({ spreadsheetId, auth: sheetsAuth, sleep: async () => {} });
      store = createSheetsWorkbookStore(transport);
      await bootstrapWorkbook(transport, store);
    });

    Then("a spreadsheet is created with sheets", async () => {
      server.use(...sheetsApiHandlers);

      expect(registry.getActive()?.id).toBe(spreadsheetId);

      // Every sheet DESIGN.md §3 names, with its header row actually
      // written — matches the feature file's table
      // (Meta/Settings/Ingredients/Recipes/RecipeIngredients/RecipeSteps/
      // PlanSlots/InventoryEvents/ShoppingItems) verbatim, kept as a
      // leading-slice check (rather than exact-equals) so the Gherkin table
      // above stays byte-for-byte what WP-11 wrote, even though
      // WORKBOOK_SHEET_NAMES itself has since grown by three more sheets
      // (M6-A — DESIGN_PRODUCTS.md §2: Products/ProductPhotos/
      // PriceObservations, the middle one later folded into Photos by
      // WP-PHOTO — DESIGN_PHOTOS.md §7), asserted separately right below.
      expect([...WORKBOOK_SHEET_NAMES].slice(0, 9)).toEqual([
        "Meta",
        "Settings",
        "Ingredients",
        "Recipes",
        "RecipeIngredients",
        "RecipeSteps",
        "PlanSlots",
        "InventoryEvents",
        "ShoppingItems",
      ]);
      // M6-A addition (DESIGN_PRODUCTS.md §2), `ProductPhotos` renamed/folded
      // into `Photos` by WP-PHOTO (DESIGN_PHOTOS.md §7), `ProductBarcodes`
      // added by WP-PRODUCTS-MODEL's barcode-set re-key — also bootstrapped,
      // with a header row, on every fresh workbook from here on.
      expect([...WORKBOOK_SHEET_NAMES].slice(9)).toEqual(["Products", "ProductBarcodes", "Photos", "PriceObservations"]);
      for (const sheet of WORKBOOK_SHEET_NAMES) {
        const row = await transport.readRange(`${sheet}!A1:Z1`);
        expect(row[0]).toEqual(WORKBOOK_HEADERS[sheet]);
      }
    });

    And("Meta contains schema_version 1 and generation 1", async () => {
      server.use(...sheetsApiHandlers);
      const meta = await store.meta.read();
      expect(meta).toEqual({ schemaVersion: 1, generation: 1 });
    });
  });

  Scenario("Malformed row does not break loading", ({ Given, When, Then }) => {
    let store: WorkbookStore;
    let result: Awaited<ReturnType<WorkbookStore["ingredients"]["readAll"]>>;

    Given('the Ingredients sheet contains a row with unit "banana-units"', async () => {
      const transport = createFakeSheetsTransport();
      await transport.updateRange("Ingredients!A1:F1", [INGREDIENTS_HEADER]);
      await transport.appendRows("Ingredients", [
        ["tomato", "Tomato", "piece", 7, 2, "pantry"],
        ["mystery-fruit", "Mystery fruit", "banana-units", 5, 2, "pantry"],
      ]);
      store = createSheetsWorkbookStore(transport);
    });

    When("the catalog is loaded", async () => {
      result = await store.ingredients.readAll();
    });

    Then("the row is excluded and a data warning lists row number and reason", () => {
      expect(result.rows.map((r) => r.id)).toEqual(["tomato"]);
      expect(result.warnings).toHaveLength(1);
      const warning = result.warnings[0]!;
      expect(warning.sheet).toBe("Ingredients");
      // Row 3: header is row 1, "tomato" is row 2, "mystery-fruit" is row 3.
      expect(warning.row).toBe(3);
      expect(warning.reason).toMatch(/unit/i);
      expect(warning.reason).toMatch(/banana-units/);
    });
  });
});
