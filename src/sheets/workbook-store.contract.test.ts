/**
 * Re-runs the shared WorkbookStore contract suite (src/domain/contract-
 * tests/workbook-store.contract.ts) against the real Sheets-backed
 * implementation, over the fake in-process SheetsTransport (WP-11 develops
 * against fakes per IMPLEMENTATION_PLAN.md WP-11's "depends WP-10 for the
 * live path"). `describeWorkbookStoreContract` never touches HTTP/msw
 * itself, so a fresh `createFakeSheetsTransport()` per `makeSubject()` call
 * is exactly the isolated, empty subject the suite expects — this is the
 * same contract WP-17/WP-20 downstream code relies on this store honouring.
 */
import { describeWorkbookStoreContract } from "../domain/contract-tests/index.ts";
import { createFakeSheetsTransport } from "../domain/fakes/index.ts";
import { createSheetsWorkbookStore } from "./workbook-store.ts";

describeWorkbookStoreContract(() => createSheetsWorkbookStore(createFakeSheetsTransport()));
