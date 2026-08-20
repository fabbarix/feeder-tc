/**
 * Unit coverage for bootstrapWorkbook (WP-11) against the in-memory fake
 * transport/store — the round-trip-through-a-live-workbook version of the
 * same scenario lives in features/wp-11-workbook-bootstrap.feature /
 * .steps.ts (the mandatory BDD scenario).
 */
import { describe, expect, it } from "vitest";
import { createFakeSheetsTransport } from "../domain/fakes/index.ts";
import { seedCatalog } from "../data/seed-catalog.ts";
import { bootstrapWorkbook, DEFAULT_SETTINGS, INITIAL_GENERATION, WORKBOOK_SHEET_NAMES } from "./bootstrap.ts";
import { SCHEMA_VERSION, WORKBOOK_HEADERS } from "./codecs/index.ts";
import { createSheetsWorkbookStore } from "./workbook-store.ts";

describe("bootstrapWorkbook", () => {
  it("writes every sheet's header row", async () => {
    const transport = createFakeSheetsTransport();
    const store = createSheetsWorkbookStore(transport);
    await bootstrapWorkbook(transport, store);

    for (const sheet of WORKBOOK_SHEET_NAMES) {
      const header = WORKBOOK_HEADERS[sheet];
      const row = await transport.readRange(`${sheet}!A1:Z1`);
      expect(row[0]).toEqual(header);
    }
  });

  it("stamps Meta with schema_version 1 and generation 1", async () => {
    const transport = createFakeSheetsTransport();
    const store = createSheetsWorkbookStore(transport);
    await bootstrapWorkbook(transport, store);

    const meta = await store.meta.read();
    expect(meta).toEqual({ schemaVersion: SCHEMA_VERSION, generation: INITIAL_GENERATION });
    expect(meta).toEqual({ schemaVersion: 1, generation: 1 });
  });

  it("writes default Settings", async () => {
    const transport = createFakeSheetsTransport();
    const store = createSheetsWorkbookStore(transport);
    await bootstrapWorkbook(transport, store);

    expect(await store.settings.read()).toEqual(DEFAULT_SETTINGS);
  });

  it("seeds the full ingredient catalog with no warnings and no duplicates", async () => {
    const transport = createFakeSheetsTransport();
    const store = createSheetsWorkbookStore(transport);
    await bootstrapWorkbook(transport, store);

    const { rows, warnings } = await store.ingredients.readAll();
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(seedCatalog.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(seedCatalog.length);
    expect(rows).toEqual(expect.arrayContaining([...seedCatalog]));
  });

  it("re-running bootstrap on an already-bootstrapped workbook replaces ingredient rows in place, not duplicates", async () => {
    const transport = createFakeSheetsTransport();
    const store = createSheetsWorkbookStore(transport);
    await bootstrapWorkbook(transport, store);
    await bootstrapWorkbook(transport, store);

    const { rows, warnings } = await store.ingredients.readAll();
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(seedCatalog.length);
  });
});
