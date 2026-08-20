/**
 * Single entry point for the shared contract suites. WP-10, WP-11 and WP-17
 * import from here to re-run the exact same behavioural suite against their
 * real implementations (see each file's header comment for which WP owns
 * the real counterpart).
 */
export { describeSheetsTransportContract } from "./sheets-transport.contract.ts";
export { describeWorkbookStoreContract } from "./workbook-store.contract.ts";
export { describeSnapshotStoreContract } from "./snapshot-store.contract.ts";
export { describeOutboxContract } from "./outbox.contract.ts";
