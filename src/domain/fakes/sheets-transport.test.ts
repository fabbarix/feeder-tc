import { describeSheetsTransportContract } from "../contract-tests/index.ts";
import { createFakeSheetsTransport } from "./sheets-transport.ts";

describeSheetsTransportContract(() => createFakeSheetsTransport());
