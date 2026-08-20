import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { createFakeSnapshotStore, createFakeWorkbookStore } from "../src/domain/fakes/index.ts";
import type { ApplyNewEvents, WorkbookStore } from "../src/domain/contracts.ts";
import {
  makeEventId,
  makeIngredientId,
  makeIsoDate,
  makeIsoTimestamp,
  makeLotId,
  makeQuantity,
  type InventoryEvent,
  type Lot,
  type Meta,
  type Snapshot,
} from "../src/domain/types.ts";
import { createLocalStorageOutbox } from "../src/sync/outbox.ts";
import { flushOutbox } from "../src/sync/flush.ts";
import { previewSnapshotWithPending, syncSnapshot } from "../src/sync/sync.ts";
import { createManualConnectivityMonitor } from "../src/sync/connectivity.ts";
import { createOutboxSyncController } from "../src/sync/outbox-sync-controller.ts";

const feature = await loadFeature("./wp-17-offline-outbox.feature");

// A minimal stand-in for WP-12's `applyNewEvents`, folding `purchase`
// (new lot) and `use` (reduces the first lot for that ingredient — not
// real FIFO) far enough to make the BDD text ("the local snapshot
// reflects both") observable end to end through the sync layer's actual
// public API. WP-17 injects `ApplyNewEvents` rather than implementing the
// fold itself (see src/sync/sync.ts header) — this is that injection
// point, filled with a throwaway double for this feature-level test only.
function foldEvents(startLots: readonly Lot[], events: readonly InventoryEvent[]): readonly Lot[] {
  let lots = [...startLots];
  for (const event of events) {
    if (event.type === "purchase") {
      lots = [
        ...lots,
        {
          id: event.lotId,
          ingredientId: event.ingredientId,
          quantity: event.quantity,
          purchaseDate: event.purchaseDate,
          location: event.location,
          expiry: makeIsoDate("2099-01-01"),
          expiryOverridden: false,
        },
      ];
    } else if (event.type === "use") {
      const idx = lots.findIndex((l) => l.ingredientId === event.ingredientId);
      if (idx !== -1) {
        const lot = lots[idx];
        if (lot !== undefined) {
          lots = lots.map((l, i) =>
            i === idx ? { ...l, quantity: { amount: l.quantity.amount - event.quantity.amount, unit: l.quantity.unit } } : l,
          );
        }
      }
    }
  }
  return lots;
}

function makeFakeApplyNewEvents(): ApplyNewEvents {
  return (snapshot, events, meta) => {
    if (meta.generation !== snapshot.generation) {
      return { kind: "reload-required", reason: "generation mismatch" };
    }
    return {
      kind: "applied",
      snapshot: {
        generation: meta.generation,
        cursor: snapshot.cursor + events.length,
        lots: foldEvents(snapshot.lots, events),
      },
    };
  };
}

function riceCheckOffEvent(): InventoryEvent {
  return {
    type: "purchase",
    id: makeEventId("evt-rice-checkoff"),
    timestamp: makeIsoTimestamp("2026-08-20T09:00:00Z"),
    ingredientId: makeIngredientId("rice"),
    lotId: makeLotId("lot-rice-1"),
    quantity: makeQuantity(400, "g"),
    location: "pantry",
    purchaseDate: makeIsoDate("2026-08-20"),
  };
}

function tomatoUsageEvent(): InventoryEvent {
  return {
    type: "use",
    id: makeEventId("evt-tomato-usage"),
    timestamp: makeIsoTimestamp("2026-08-20T09:05:00Z"),
    ingredientId: makeIngredientId("tomato"),
    quantity: makeQuantity(2, "piece"),
  };
}

describeFeature(feature, ({ Scenario }) => {
  Scenario("Writes queue while offline and flush on reconnect", ({ Given, When, Then, And }) => {
    const workbookId = "wb-1";
    const meta: Meta = { schemaVersion: 1, generation: 1 };
    const applyNewEvents = makeFakeApplyNewEvents();
    let workbookStore: WorkbookStore;
    let outbox: ReturnType<typeof createLocalStorageOutbox>;
    let connectivity: ReturnType<typeof createManualConnectivityMonitor>;
    let confirmedSnapshot: Snapshot;

    Given("the client is offline", () => {
      window.localStorage.clear();
      workbookStore = createFakeWorkbookStore();
      outbox = createLocalStorageOutbox(workbookId, window.localStorage);
      connectivity = createManualConnectivityMonitor(false);
      // Confirmed baseline: a tomato lot already in the pantry so "logs
      // usage of 2 tomatoes" has stock to fold against.
      confirmedSnapshot = {
        generation: meta.generation,
        cursor: 0,
        lots: [
          {
            id: makeLotId("lot-tomato-0"),
            ingredientId: makeIngredientId("tomato"),
            quantity: makeQuantity(5, "piece"),
            purchaseDate: makeIsoDate("2026-08-15"),
            location: "pantry",
            expiry: makeIsoDate("2099-01-01"),
            expiryOverridden: false,
          },
        ],
      };
    });

    When('the user checks off "rice: 400 g" and logs usage of 2 tomatoes', async () => {
      await outbox.enqueue(riceCheckOffEvent());
      await outbox.enqueue(tomatoUsageEvent());
    });

    Then("2 events sit in the outbox and the local snapshot reflects both", async () => {
      const pending = await outbox.pending();
      expect(pending.map((e) => e.id)).toEqual([makeEventId("evt-rice-checkoff"), makeEventId("evt-tomato-usage")]);

      const preview = previewSnapshotWithPending(confirmedSnapshot, pending, meta, applyNewEvents);
      const riceLot = preview.lots.find((l) => l.ingredientId === makeIngredientId("rice"));
      const tomatoLot = preview.lots.find((l) => l.ingredientId === makeIngredientId("tomato"));
      expect(riceLot?.quantity).toEqual(makeQuantity(400, "g"));
      expect(tomatoLot?.quantity).toEqual(makeQuantity(3, "piece")); // 5 - 2
      // The pending fold is display-only: it must never advance the
      // confirmed cursor/generation (invariant 2 territory — those only
      // ever move on a real, server-confirmed sync).
      expect(preview.cursor).toBe(confirmedSnapshot.cursor);
      expect(preview.generation).toBe(confirmedSnapshot.generation);
    });

    When("connectivity returns", async () => {
      connectivity.setOnline(true);
      const controller = createOutboxSyncController({ outbox, workbookStore, connectivity });
      await controller.flushNow();
    });

    Then("both events are appended to InventoryEvents in order", async () => {
      const page = await workbookStore.inventoryEvents.readFrom(0);
      expect(page.rows.map((r) => r.id)).toEqual([makeEventId("evt-rice-checkoff"), makeEventId("evt-tomato-usage")]);
    });

    And("the outbox is empty", async () => {
      expect(await outbox.pending()).toEqual([]);
    });
  });

  Scenario("Flush retry does not duplicate events", ({ Given, When, Then }) => {
    const workbookStore = createFakeWorkbookStore();
    const outbox = createInMemoryOutbox();
    let flushedResultRows: readonly InventoryEvent[] = [];

    Given("an outbox flush where the first append times out after the server applied it", async () => {
      await outbox.enqueue(tomatoUsageEvent());
    });

    When("the flush retries", async () => {
      let calls = 0;
      const realAppend = workbookStore.inventoryEvents.append.bind(workbookStore.inventoryEvents);
      const timingOutOnceStore: WorkbookStore = {
        ...workbookStore,
        inventoryEvents: {
          ...workbookStore.inventoryEvents,
          append: async (event) => {
            calls += 1;
            await realAppend(event); // the server DOES apply it...
            if (calls === 1) {
              throw new Error("simulated: response lost after the server applied the append");
            }
          },
        },
      };
      await flushOutbox({ outbox, workbookStore: timingOutOnceStore, sleep: async () => {} });
      flushedResultRows = (await workbookStore.inventoryEvents.readFrom(0)).rows;
    });

    Then("InventoryEvents contains the event exactly once", () => {
      const matches = flushedResultRows.filter((r) => r.id === makeEventId("evt-tomato-usage"));
      expect(matches).toHaveLength(1);
    });
  });

  Scenario("Incremental sync uses the cursor", ({ Given, When, Then }) => {
    const workbookId = "wb-1";
    const workbookStore = createFakeWorkbookStore();
    const snapshotStore = createFakeSnapshotStore();
    const applyNewEvents = makeFakeApplyNewEvents();
    const readFromCalls: number[] = [];
    let result: Snapshot;

    Given("a snapshot with cursor 120 and matching generation", async () => {
      await workbookStore.meta.write({ schemaVersion: 1, generation: 1 });
      await snapshotStore.save(workbookId, { generation: 1, cursor: 120, lots: [] });
    });

    When("sync runs and the sheet has 125 rows", async () => {
      for (let i = 0; i < 125; i += 1) {
        await workbookStore.inventoryEvents.append(tomatoUsageEventWithId(`evt-${i}`));
      }
      const spiedStore: WorkbookStore = {
        ...workbookStore,
        inventoryEvents: {
          ...workbookStore.inventoryEvents,
          readFrom: async (cursor: number) => {
            readFromCalls.push(cursor);
            return workbookStore.inventoryEvents.readFrom(cursor);
          },
        },
      };
      result = await syncSnapshot({ workbookStore: spiedStore, snapshotStore, applyNewEvents }, workbookId);
    });

    Then("only rows 121-125 are fetched and folded", () => {
      expect(readFromCalls).toEqual([120]);
      expect(result.cursor).toBe(125); // 120 + the 5 fetched rows (121..125)
    });
  });
});

function tomatoUsageEventWithId(id: string): InventoryEvent {
  return {
    type: "use",
    id: makeEventId(id),
    timestamp: makeIsoTimestamp("2026-08-20T09:05:00Z"),
    ingredientId: makeIngredientId("tomato"),
    quantity: makeQuantity(1, "piece"),
  };
}

function createInMemoryOutbox() {
  // A tiny in-memory Outbox, independent from the localStorage one used in
  // the first scenario, so this scenario's retry/dedupe behaviour is
  // isolated from storage concerns entirely (it is exercising flushOutbox,
  // not Outbox persistence).
  const queue: InventoryEvent[] = [];
  return {
    async enqueue(event: InventoryEvent) {
      if (!queue.some((e) => e.id === event.id)) queue.push(event);
    },
    async pending() {
      return [...queue];
    },
    async acknowledge(eventId: InventoryEvent["id"]) {
      const idx = queue.findIndex((e) => e.id === eventId);
      if (idx !== -1) queue.splice(idx, 1);
    },
    async clear() {
      queue.length = 0;
    },
  };
}
