// Google auth + Sheets transport (WP-10). Row<->entity codecs and the
// WorkbookStore implementation on top of this land in a sibling area under
// WP-11 - this barrel only covers WP-10's own scope: the token client,
// Picker integration, the real SheetsTransport, workbook creation, and the
// multi-workbook registry.

export { createGoogleAuth, DRIVE_FILE_SCOPE, type AuthState, type GoogleAuth, type GoogleAuthDeps } from "./auth.ts";
export { ReAuthRequiredError, SheetsHttpError } from "./errors.ts";
export {
  createGooglePickerLauncher,
  pickWorkbook,
  type PickedWorkbook,
  type PickerLauncher,
} from "./picker.ts";
export {
  createWorkbookRegistry,
  type WorkbookRegistry,
  type WorkbookRegistryEntry,
} from "./registry.ts";
export { createSpreadsheet, createWorkbook, type CreateSpreadsheetOptions } from "./spreadsheet.ts";
export {
  createGoogleSheetsTransport,
  type CreateSheetsTransportOptions,
  type SheetsAuthAdapter,
} from "./transport.ts";
