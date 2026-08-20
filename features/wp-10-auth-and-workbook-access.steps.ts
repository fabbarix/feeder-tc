import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { server } from "../src/mocks/server.ts";
import { createGoogleAuth, type GoogleAuthDeps } from "../src/sheets/auth.ts";
import { createWorkbookRegistry } from "../src/sheets/registry.ts";
import { pickWorkbook, type PickerLauncher } from "../src/sheets/picker.ts";
import { createWorkbook } from "../src/sheets/spreadsheet.ts";
import { createGoogleSheetsTransport, type SheetsAuthAdapter } from "../src/sheets/transport.ts";
import { createSheetsApiHandlers, createSpreadsheetCreationHandler } from "../src/sheets/mocks/handlers.ts";
import type { CellGrid } from "../src/domain/contracts.ts";

const feature = await loadFeature("./wp-10-auth-and-workbook-access.feature");

let registryKeyCounter = 0;

describeFeature(feature, ({ Scenario }) => {
  Scenario("First sign-in creates no workbook until requested", ({ Given, When, Then }) => {
    let auth: ReturnType<typeof createGoogleAuth>;
    // Counted via an explicit fetchImpl passed to createWorkbook() below,
    // never by spying on globalThis.fetch - msw already patches that global
    // once for the whole run (src/mocks/vitest.setup.ts), and a spy/restore
    // cycle on top of it here would risk unpatching msw for every later
    // scenario in this file.
    let sheetsApiCallCount = 0;

    Given("a signed-out user", () => {
      // A fake GIS token client: no network call anywhere, matching the real
      // GIS flow (a script + postMessage dance, never a fetch()) - the
      // Sheets API calls this scenario cares about are exclusively the
      // fetch()-based Sheets REST calls asserted on below.
      const deps: GoogleAuthDeps = {
        async createTokenClient(callback) {
          return {
            requestAccessToken() {
              queueMicrotask(() => callback({ access_token: "tok-abc", expires_in: 3600 }));
            },
          };
        },
        async revoke() {},
        now: () => 0,
      };
      auth = createGoogleAuth("test-client-id", deps);
      expect(auth.state()).toBe("signed-out");
    });

    When("they sign in with Google", async () => {
      await auth.signIn();
    });

    Then("no Sheets API calls are made until they create or pick a workbook", async () => {
      expect(auth.state()).toBe("signed-in");
      expect(sheetsApiCallCount).toBe(0); // signIn() alone never touches fetch()

      // Demonstrate the "until" boundary: creating a workbook is the first
      // action that is allowed to talk to a Google API, and it does.
      registryKeyCounter += 1;
      const registry = createWorkbookRegistry(localStorage, `feeder.workbookRegistry.bdd-${registryKeyCounter}`);
      server.use(
        createSpreadsheetCreationHandler("tok-abc", (title) => ({ spreadsheetId: "new-sheet-1", title })),
      );
      const countingFetch: typeof fetch = async (input, init) => {
        sheetsApiCallCount += 1;
        return fetch(input, init);
      };

      await createWorkbook("Our Meal Planner", auth, registry, { fetchImpl: countingFetch });

      expect(sheetsApiCallCount).toBe(1);
      expect(registry.getActive()?.id).toBe("new-sheet-1");
    });
  });

  Scenario("Opening a shared workbook via Picker", ({ Given, When, Then, And }) => {
    const AUTH: SheetsAuthAdapter = { getAccessToken: async () => "tok-abc", invalidate: () => {} };
    let registry: ReturnType<typeof createWorkbookRegistry>;
    let launcher: PickerLauncher;

    Given("a signed-in user with no workbook configured", () => {
      registryKeyCounter += 1;
      registry = createWorkbookRegistry(localStorage, `feeder.workbookRegistry.bdd-${registryKeyCounter}`);
      expect(registry.getActive()).toBeUndefined();
    });

    When('they pick spreadsheet "fam-123" in the Google Picker', async () => {
      launcher = {
        async open() {
          return { id: "fam-123", name: "Family Meal Planner" };
        },
      };
      await pickWorkbook(launcher, AUTH, registry);
    });

    Then('"fam-123" is stored in the workbook registry', () => {
      expect(registry.list().some((entry) => entry.id === "fam-123")).toBe(true);
    });

    And("it becomes the active workbook", () => {
      expect(registry.getActive()?.id).toBe("fam-123");
    });
  });

  Scenario("Rate limit is retried", ({ Given, When, Then }) => {
    const ACCESS_TOKEN = "tok-abc";
    const spreadsheetId = "bdd-rate-limit-sheet";
    let transport: ReturnType<typeof createGoogleSheetsTransport>;
    let sleepCalls: number[];
    let rows: CellGrid;

    Given("the Sheets API responds 429 then 200 for a read", () => {
      // Each Given/When/Then step below is its own vitest `it()`
      // (@amiceli/vitest-cucumber's design), and src/mocks/vitest.setup.ts
      // resets msw's handlers in afterEach - so a mock registered here would
      // already be gone by the time the "When" step's fetch actually fires.
      // Only the transport/state setup that doesn't touch the network
      // belongs in Given; the server.use() call itself has to live in the
      // step that performs the request (see "When" below).
      sleepCalls = [];
      transport = createGoogleSheetsTransport({
        spreadsheetId,
        auth: { getAccessToken: async () => ACCESS_TOKEN, invalidate: () => {} },
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      });
    });

    When('the transport reads range "InventoryEvents!A2:H"', async () => {
      server.use(
        ...createSheetsApiHandlers({
          spreadsheetId,
          accessToken: ACCESS_TOKEN,
          failures: [{ status: 429, retryAfterSeconds: 1 }],
        }),
      );
      rows = await transport.readRange("InventoryEvents!A2:H");
    });

    Then("the read succeeds after one retry", () => {
      expect(rows).toEqual([]);
      expect(sleepCalls).toEqual([1000]);
    });
  });
});
