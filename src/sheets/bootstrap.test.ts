/**
 * Unit coverage for bootstrapWorkbook (WP-11) against the in-memory fake
 * transport/store — the round-trip-through-a-live-workbook version of the
 * same scenario lives in features/wp-11-workbook-bootstrap.feature /
 * .steps.ts (the mandatory BDD scenario).
 */
import { describe, expect, it } from "vitest";
import { createFakeSheetsTransport } from "../domain/fakes/index.ts";
import { seedCatalog } from "../data/seed-catalog.ts";
import { makeBarcode, makeIsoTimestamp, type Photo } from "../domain/types.ts";
import { bootstrapWorkbook, DEFAULT_SETTINGS, INITIAL_GENERATION, WORKBOOK_SHEET_NAMES } from "./bootstrap.ts";
import { columnLetter, PHOTOS_HEADER, SCHEMA_VERSION, WORKBOOK_HEADERS } from "./codecs/index.ts";
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

  // WP-PHOTO — DESIGN_PHOTOS.md: a workbook created before this change was
  // bootstrapped with only the eleven sheets that existed then; `Photos`
  // never got a tab at all, not even an empty one. `ensureHeader`
  // (workbook-store.ts) self-heals a sheet's header on first write, and
  // `appendRows` (the in-memory fake, mirroring the real Sheets API) creates
  // a missing tab on demand — together they mean such a workbook gains
  // `Photos` the first time anything writes a photo, with no rebuild/
  // re-bootstrap step required. This test proves that end to end rather
  // than assuming it: it deliberately never calls `bootstrapWorkbook`'s
  // current (Photos-including) sheet list, only mimics what an old
  // bootstrap would have written, then exercises the store's `photos`
  // namespace directly against that pre-existing state.
  it("a legacy workbook with no Photos sheet gains one on first photo upsert, no rebuild needed", async () => {
    const transport = createFakeSheetsTransport();
    const store = createSheetsWorkbookStore(transport);

    // Simulate a workbook bootstrapped before WP-PHOTO: every sheet EXCEPT
    // Photos already has its header row written.
    for (const sheet of WORKBOOK_SHEET_NAMES) {
      if (sheet === "Photos") continue;
      const header = WORKBOOK_HEADERS[sheet];
      const lastCol = columnLetter(header.length);
      await transport.updateRange(`${sheet}!A1:${lastCol}1`, [header]);
    }

    // Before any photo is ever written, Photos!A1 has nothing on it — this
    // is the "tab doesn't really exist yet" state the fake transport (and
    // the real Sheets API's own missing-tab fallback, see transport.ts)
    // represents as an empty read rather than an error.
    expect(await transport.readRange("Photos!A1:D1")).toEqual([]);

    const photo: Photo = {
      ownerKind: "product",
      ownerId: makeBarcode("8001120000123"),
      dataUrl: "data:image/webp;base64,bGVnYWN5LXdvcmtib29r",
      updatedAt: makeIsoTimestamp("2026-08-21T09:00:00Z"),
    };
    await store.photos.upsert(photo);

    // The header self-healed...
    expect(await transport.readRange("Photos!A1:D1")).toEqual([PHOTOS_HEADER]);
    // ...and the photo itself reads back correctly, through the same store
    // this "legacy" workbook now transparently supports.
    expect(await store.photos.get("product", photo.ownerId)).toEqual(photo);
  });
});
