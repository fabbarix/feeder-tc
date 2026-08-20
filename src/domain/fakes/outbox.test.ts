import { describeOutboxContract } from "../contract-tests/index.ts";
import { createFakeOutbox } from "./outbox.ts";

describeOutboxContract(() => createFakeOutbox());
