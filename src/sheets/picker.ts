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

/** Real Picker launcher: loads gapi + the Picker library and shows Google's own file-chooser UI, scoped to Sheets. */
export function createGooglePickerLauncher(apiKey: string): PickerLauncher {
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
