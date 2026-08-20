/**
 * Minimal ambient types for the two Google browser globals this package
 * loads via <script> tag: Google Identity Services (GIS) for the OAuth token
 * client, and gapi/Picker for the workbook picker. Hand-written and scoped to
 * exactly what google-loader.ts / auth.ts / picker.ts call - not a general
 * @types package, which would pull in far more surface than we use (and,
 * for Picker in particular, published types are inconsistent across
 * versions).
 *
 * Both globals are `undefined` until their script has loaded; every access
 * site goes through google-loader.ts's `loadScriptOnce`, which resolves only
 * after the script's `onload` fires, so by the time this code touches
 * `window.google`/`window.gapi` the shape below is guaranteed present.
 */

export interface GoogleTokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly error?: string;
  readonly error_description?: string;
}

export interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

export interface GoogleTokenClientConfig {
  readonly client_id: string;
  readonly scope: string;
  readonly callback: (response: GoogleTokenResponse) => void;
  readonly error_callback?: (error: { type: string; message?: string }) => void;
}

export interface GoogleAccountsOauth2 {
  initTokenClient(config: GoogleTokenClientConfig): GoogleTokenClient;
  revoke(accessToken: string, done: () => void): void;
}

export interface GooglePickerDocument {
  readonly id: string;
  readonly name: string;
}

export interface GooglePickerResponse {
  readonly action: string;
  readonly docs?: readonly GooglePickerDocument[];
}

export interface GooglePickerView {
  setMimeTypes(mimeTypes: string): GooglePickerView;
}

export interface GooglePickerBuilder {
  addView(view: GooglePickerView | string): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setCallback(callback: (response: GooglePickerResponse) => void): GooglePickerBuilder;
  build(): GooglePicker;
}

export interface GooglePicker {
  setVisible(visible: boolean): void;
}

export interface GooglePickerNamespace {
  PickerBuilder: new () => GooglePickerBuilder;
  DocsView: new (viewId?: string) => GooglePickerView;
  ViewId: { readonly SPREADSHEETS: string };
  Action: { readonly PICKED: string; readonly CANCEL: string };
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleAccountsOauth2;
      };
      picker?: GooglePickerNamespace;
    };
    gapi?: {
      load(api: string, callback: () => void): void;
    };
  }
}
