/**
 * Google Picker integration for opening a workbook shared by another
 * household member (WP-10). Opening the Picker is how a `drive.file`-scoped
 * app is allowed to touch a file it did not itself create - the scope is
 * granted per-file, per-pick, by the user's selection.
 *
 * `VITE_GOOGLE_API_KEY` (env.googleApiKey) is used ONLY inside
 * createGooglePickerLauncher() below, via setDeveloperKey() - never on a
 * Sheets/Drive REST call (see src/env.ts, transport.ts's header comment,
 * and the merge-review checklist in IMPLEMENTATION_PLAN.md WP-10).
 */
import { loadScriptOnce } from "./google-loader.ts";
import type { GooglePickerResponse } from "./google-globals.ts";
import type { WorkbookRegistry, WorkbookRegistryEntry } from "./registry.ts";
import type { SheetsAuthAdapter } from "./transport.ts";

export type PickedWorkbook = WorkbookRegistryEntry;

export interface PickerLauncher {
  /** Resolves with the picked file, or undefined if the user closed the Picker without choosing one. */
  open(accessToken: string): Promise<PickedWorkbook | undefined>;
}

function toPickedWorkbook(response: GooglePickerResponse): PickedWorkbook | undefined {
  const doc = response.docs?.[0];
  if (!doc) return undefined;
  return { id: doc.id, name: doc.name };
}

/**
 * The Cloud project number, which the Picker needs as its app ID. Google
 * OAuth web client IDs are `<project number>-<hash>.apps.googleusercontent.com`,
 * so it is read off the client ID rather than configured separately.
 */
export function projectNumberFromClientId(clientId: string): string {
  const match = /^(\d+)-/.exec(clientId);
  if (!match?.[1]) {
    throw new Error(`Can't read the Cloud project number from OAuth client ID "${clientId}".`);
  }
  return match[1];
}

/**
 * Real Picker launcher: loads gapi + the Picker library and shows Google's own file-chooser UI, scoped to Sheets.
 *
 * The app ID (the Cloud project number, read off `clientId`) is what makes a
 * pick actually grant this app `drive.file` access to the chosen file. Without `setAppId` the Picker
 * still shows and returns the file, but the grant never happens - so a sheet
 * someone else shared, which the app did not create, then fails every Sheets
 * call with "no access". It is derived inside `open()`, not here, so a
 * malformed client ID surfaces as the Picker's error toast instead of
 * breaking the app's first render.
 */
export function createGooglePickerLauncher(apiKey: string, clientId: string): PickerLauncher {
  let pickerApiLoaded: Promise<void> | undefined;

  async function ensurePickerApi(): Promise<void> {
    if (!pickerApiLoaded) {
      pickerApiLoaded = (async () => {
        await loadScriptOnce("https://apis.google.com/js/api.js");
        await new Promise<void>((resolve) => window.gapi?.load("picker", () => resolve()));
      })();
    }
    return pickerApiLoaded;
  }

  return {
    async open(accessToken: string): Promise<PickedWorkbook | undefined> {
      const appId = projectNumberFromClientId(clientId);
      await ensurePickerApi();
      const picker = window.google?.picker;
      if (!picker) {
        // Plain language on purpose (jargon sweep, WP-fix-sheets-429) -
        // reaches App.tsx's handlePickWorkbook catch, whose toast shows this
        // verbatim.
        throw new Error("Couldn't open the file picker. Please try again.");
      }
      return new Promise<PickedWorkbook | undefined>((resolve, reject) => {
        try {
          const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
          const instance = new picker.PickerBuilder()
            .addView(view)
            .setOAuthToken(accessToken)
            .setAppId(appId) // Grants drive.file on the picked file - see createGooglePickerLauncher's doc comment.
            .setDeveloperKey(apiKey) // Picker-only use of the API key - see file header.
            .setCallback((response: GooglePickerResponse) => {
              if (response.action === picker.Action.PICKED) {
                resolve(toPickedWorkbook(response));
              } else if (response.action === picker.Action.CANCEL) {
                resolve(undefined);
              }
            })
            .build();
          instance.setVisible(true);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
  };
}

/**
 * Opens the picker (requires an already-signed-in `auth`, itself the
 * product of an earlier user gesture), and on a pick, registers the file
 * and makes it the active workbook - the BDD "Opening a shared workbook via
 * Picker" scenario end to end.
 */
export async function pickWorkbook(
  launcher: PickerLauncher,
  auth: SheetsAuthAdapter,
  registry: WorkbookRegistry,
): Promise<PickedWorkbook | undefined> {
  const accessToken = await auth.getAccessToken();
  const picked = await launcher.open(accessToken);
  if (!picked) return undefined;
  registry.add(picked);
  registry.setActive(picked.id);
  return picked;
}
