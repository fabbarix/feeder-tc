import { describeWorkbookStoreContract } from "../contract-tests/index.ts";
import { createFakeWorkbookStore } from "./workbook-store.ts";

describeWorkbookStoreContract(() => createFakeWorkbookStore());
