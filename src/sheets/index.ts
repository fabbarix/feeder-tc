// Google auth + Sheets transport (WP-10), plus row<->entity codecs, the
// WorkbookStore implementation, and the create-workbook bootstrap flow
// (WP-11): the token client, Picker integration, the real SheetsTransport,
// workbook creation, the multi-workbook registry, and everything that turns
// a freshly-created (empty-tabs) spreadsheet into a usable workbook.

export { createGoogleAuth, DRIVE_FILE_SCOPE, type AuthState, type GoogleAuth, type GoogleAuthDeps } from "./auth.ts";
export {
  bootstrapWorkbook,
  DEFAULT_SETTINGS,
  INITIAL_GENERATION,
  WORKBOOK_SHEET_NAMES,
} from "./bootstrap.ts";
export * from "./codecs/index.ts";
export { ReAuthRequiredError, SheetsHttpError } from "./errors.ts";
export {
  ensureWorkbookSchema,
  type EnsureWorkbookSchemaOptions,
  type EnsureWorkbookSchemaResult,
} from "./migrate.ts";
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
  ensureSheetExists,
  listSheetTitles,
  type CreateSheetsTransportOptions,
  type SheetsAuthAdapter,
} from "./transport.ts";
export { createSheetsWorkbookStore } from "./workbook-store.ts";
export { fetchAuthenticatedUser, type AuthenticatedUser } from "./user-info.ts";
