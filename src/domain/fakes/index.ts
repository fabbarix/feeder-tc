/**
 * Single entry point for every in-memory fake, so all seven Stage-1 work
 * packages import fakes one way: `import { createFakeWorkbookStore, ... }
 * from "../../domain/fakes"`.
 */
export { createFakeSheetsTransport } from "./sheets-transport.ts";
export { createFakeWorkbookStore } from "./workbook-store.ts";
export { createFakeSnapshotStore } from "./snapshot-store.ts";
export { createFakeOutbox } from "./outbox.ts";
export { createManualClock, createFixedClock, type ManualClock } from "./clock.ts";
export { createFakeRng } from "./rng.ts";
