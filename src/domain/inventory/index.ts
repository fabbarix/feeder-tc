// WP-12: the pure inventory engine. See src/domain/README.md for the
// dependency-direction rule this module obeys (imports only from sibling
// src/domain files; no src/sheets, src/sync, src/ui, src/routes).
export {
  computeExpiry,
  DEFAULT_FREEZER_SUSPENSION_DAYS,
  type ComputeExpiryInput,
} from "./expiry.ts";
export {
  compareLotsForFifo,
  planFifoConsumption,
  type FifoAllocation,
  type FifoPlan,
} from "./fifo.ts";
export {
  foldInventoryEvents,
  type FoldOptions,
  type FoldResult,
  type FoldWarning,
} from "./fold.ts";
export { createApplyNewEvents } from "./sync.ts";
export { createLeftoverLot, type CreateLeftoverLotInput } from "./leftovers.ts";
