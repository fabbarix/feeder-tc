import { describeSnapshotStoreContract } from "../contract-tests/index.ts";
import { createFakeSnapshotStore } from "./snapshot-store.ts";

describeSnapshotStoreContract(() => createFakeSnapshotStore());
