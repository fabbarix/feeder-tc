/**
 * WP-24-UI's mandatory scenario (IMPLEMENTATION_PLAN.md WP-24, amended by
 * UI_DESIGN.md §8: a global banner, not a per-item indicator).
 *
 * The shopping list itself is WP-23 and does not exist yet (its route is
 * still `EmptyState` — see `src/routes/Shopping.tsx`), so there is no real
 * "check off a shopping-list row" UI to drive end to end. Per
 * IMPLEMENTATION_PLAN.md's own instruction for exactly this situation, this
 * test drives the scenario against the REAL outbox/sync/banner primitives
 * with a stubbed check-off standing in for the not-yet-built row — see
 * `wp-24-offline-store-trip.harness.tsx`'s header comment for exactly what
 * is real production code here (the outbox, the sync controller/flush, the
 * check-off engine, `AppShell`, `CheckRow`) and what is stubbed (only the
 * one hand-built row).
 *
 * That same harness comment also explains why every step below renders a
 * FRESH, disposable instance of `AppShell`/`CheckRow` rather than sharing
 * one mounted tree across steps: `@amiceli/vitest-cucumber` runs each
 * Given/When/Then as its own Vitest test, and this suite's global
 * `afterEach(cleanup)` unmounts between them. The real state driving each
 * render — `pendingCount`, `offline`, `checked` — is plain data carried in
 * this file's closure, read fresh from the real `Outbox`/`WorkbookStore`
 * each time, exactly like `wp-17-offline-outbox.steps.ts` already does for
 * its own (non-rendering) assertions.
 *
 * This is NOT a full Playwright E2E driving real UI through the real
 * `/shopping` route (there is nothing there yet to drive) — see the
 * WP-24-UI handover report for that caveat stated plainly.
 * `e2e/wp-24-offline-banner.spec.ts` separately covers the offline/online
 * half of the banner through the real browser + the real `App.tsx`
 * container, which needs no shopping list at all.
 */
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeIngredientId, type WorkbookStore } from "../src/domain/index.ts";
import { createFakeWorkbookStore } from "../src/domain/fakes/index.ts";
import { createLocalStorageOutbox } from "../src/sync/outbox.ts";
import { createManualConnectivityMonitor, type ManualConnectivityMonitor } from "../src/sync/connectivity.ts";
import type { Outbox } from "../src/domain/contracts.ts";
import { checkOffRice, renderAppShellBanner, renderCheckOffRow, startSync } from "./wp-24-offline-store-trip.harness.tsx";

const feature = await loadFeature("./wp-24-offline-store-trip.feature");

describeFeature(feature, ({ Scenario }) => {
  Scenario("Checking off while offline", ({ Given, When, Then, And }) => {
    let workbookStore: WorkbookStore;
    let outbox: Outbox;
    let connectivity: ManualConnectivityMonitor;
    let stopSync: () => void;
    let checked = false;

    async function pendingCount(): Promise<number> {
      return (await outbox.pending()).length;
    }

    Given("the app is installed and the shopping list is loaded", () => {
      window.localStorage.clear();
      workbookStore = createFakeWorkbookStore();
      outbox = createLocalStorageOutbox("wp24-offline-trip", window.localStorage);
      connectivity = createManualConnectivityMonitor(true);
      // Real WP-17 controller, subscribed from the start — exactly like
      // `App.tsx`'s `ShellContainer` starts it as soon as a workbook/outbox
      // pair exists, not only once the network happens to be offline.
      stopSync = startSync(outbox, workbookStore, connectivity);
    });

    And("the network goes offline", async () => {
      connectivity.setOnline(false);
      renderAppShellBanner(!connectivity.isOnline(), await pendingCount());
      expect(screen.getByRole("status")).toHaveTextContent(/you're offline/i);
    });

    When('the user checks off "rice: 400 g"', async () => {
      const user = userEvent.setup();
      renderCheckOffRow(false, () => {
        checked = true;
        void checkOffRice(outbox);
      });
      await user.click(screen.getByRole("checkbox", { name: /rice/i }));
      await waitFor(async () => {
        expect(await pendingCount()).toBe(1);
      });
    });

    Then("the item shows as bought", () => {
      expect(checked).toBe(true);
      renderCheckOffRow(checked, () => undefined);
      expect(screen.getByRole("checkbox", { name: /rice/i })).toBeChecked();
    });

    And("the sync banner reports 1 change waiting", async () => {
      renderAppShellBanner(!connectivity.isOnline(), await pendingCount());
      expect(screen.getByRole("status")).toHaveTextContent(/1 change waiting to sync/i);
    });

    When("the network returns", () => {
      connectivity.setOnline(true);
    });

    Then("the purchase event reaches the workbook and the banner clears", async () => {
      await waitFor(async () => {
        const page = await workbookStore.inventoryEvents.readFrom(0);
        expect(page.rows).toHaveLength(1);
        expect(page.rows[0]).toMatchObject({ type: "purchase", ingredientId: makeIngredientId("rice") });
      });
      await waitFor(async () => {
        expect(await pendingCount()).toBe(0);
      });
      renderAppShellBanner(!connectivity.isOnline(), await pendingCount());
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      stopSync();
    });
  });
});
