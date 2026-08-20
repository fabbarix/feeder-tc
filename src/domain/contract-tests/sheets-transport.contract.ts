/**
 * Shared SheetsTransport behavioural contract. WP-10 re-runs this exact
 * suite against the real Sheets-REST-API-backed implementation; it must not
 * depend on anything the fake alone provides (design requirement 9 /
 * WP-02 success criteria: "Fakes pass a shared contract test-suite, same
 * suite later reused against real implementations").
 */
import { describe, expect, it } from "vitest";
import type { SheetsTransport } from "../contracts.ts";

export function describeSheetsTransportContract(makeSubject: () => SheetsTransport): void {
  describe("SheetsTransport contract", () => {
    it("readRange on an untouched range returns no rows", async () => {
      const transport = makeSubject();
      const rows = await transport.readRange("Ingredients!A2:E");
      expect(rows).toEqual([]);
    });

    it("appendRows then readRange returns the appended rows", async () => {
      const transport = makeSubject();
      await transport.appendRows("Ingredients", [
        ["ing-1", "Rice", "g", "730", "5", "pantry"],
        ["ing-2", "Milk", "ml", "10", "3", "fridge"],
      ]);
      const rows = await transport.readRange("Ingredients!A1:F");
      expect(rows).toEqual([
        ["ing-1", "Rice", "g", "730", "5", "pantry"],
        ["ing-2", "Milk", "ml", "10", "3", "fridge"],
      ]);
    });

    it("appendRows a second time appends after the existing rows, never overwrites them", async () => {
      const transport = makeSubject();
      await transport.appendRows("InventoryEvents", [["evt-1", "purchase"]]);
      const result = await transport.appendRows("InventoryEvents", [["evt-2", "use"]]);
      const rows = await transport.readRange("InventoryEvents!A1:B");
      expect(rows).toEqual([
        ["evt-1", "purchase"],
        ["evt-2", "use"],
      ]);
      expect(result.updatedRange).toContain("InventoryEvents!A2");
    });

    it("updateRange overwrites only the targeted cells, leaving surrounding rows untouched", async () => {
      const transport = makeSubject();
      await transport.appendRows("Recipes", [
        ["rec-1", "Chili", "cooked"],
        ["rec-2", "Store lasagna", "bought"],
      ]);
      await transport.updateRange("Recipes!A1:C1", [["rec-1", "Chili con carne", "cooked"]]);
      const rows = await transport.readRange("Recipes!A1:C2");
      expect(rows).toEqual([
        ["rec-1", "Chili con carne", "cooked"],
        ["rec-2", "Store lasagna", "bought"],
      ]);
    });

    it("batchRead returns one grid per requested range, in the same order", async () => {
      const transport = makeSubject();
      await transport.appendRows("Meta", [["1", "1"]]);
      await transport.appendRows("Settings", [["4"]]);
      const [metaRows, settingsRows] = await transport.batchRead(["Meta!A1:B1", "Settings!A1:A1"]);
      expect(metaRows).toEqual([["1", "1"]]);
      expect(settingsRows).toEqual([["4"]]);
    });

    it("an open-ended row range (e.g. A2:H) reads through to the last row present", async () => {
      const transport = makeSubject();
      await transport.appendRows("InventoryEvents", [["h1", "h2"]]); // header row
      await transport.appendRows("InventoryEvents", [
        ["evt-1", "purchase"],
        ["evt-2", "use"],
        ["evt-3", "spoil"],
      ]);
      const rows = await transport.readRange("InventoryEvents!A2:B");
      expect(rows).toEqual([
        ["evt-1", "purchase"],
        ["evt-2", "use"],
        ["evt-3", "spoil"],
      ]);
    });
  });
}
