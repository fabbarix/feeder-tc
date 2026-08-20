import { http, HttpResponse, type HttpHandler } from "msw";
import { createSheetsApiHandlers, createSpreadsheetCreationHandler } from "../sheets/mocks/handlers.ts";

/**
 * Shared msw request handlers, used by both Vitest (msw/node, via
 * src/mocks/server.ts) and Playwright E2E (msw/browser, via
 * src/mocks/browser.ts). CI must never call real Google APIs — every WP that
 * talks to the Sheets/Drive/Picker REST surface adds its handlers here (or in
 * per-feature handler modules composed into that array) instead of hitting
 * the network in tests.
 *
 * WP-20 wires the real `createGoogleAuth`/Picker/Sheets-transport into
 * `AppShell` (src/App.tsx) — E2E now exercises that real code path, not a
 * local demo stub, so this file has to fake the whole surface it touches:
 *
 *  - The GIS (`accounts.google.com/gsi/client`) and gapi/Picker
 *    (`apis.google.com/js/api.js`) `<script>` tags `loadScriptOnce`
 *    injects. These are NOT `fetch`/XHR calls, but msw/browser installs a
 *    real Service Worker, which intercepts every subresource request in its
 *    scope — including `<script src>` loads — so a plain `http.get` handler
 *    here is enough; no separate mechanism is needed.
 *  - Creating a spreadsheet, and every Sheets values/batchUpdate call
 *    against it (bootstrap writes nine header rows, Meta, Settings, and the
 *    ~100-row seeded catalog).
 *  - Drive's `about.get`, which `src/sheets/user-info.ts` calls to identify
 *    the signed-in user without a broader OAuth scope.
 *
 * Every fake token/id below is a fixed constant BOTH sides of this file
 * agree on — the fake GIS script hands back FAKE_ACCESS_TOKEN, and every
 * other handler only answers requests bearing exactly that token, so a bug
 * that skipped auth (e.g. an unauthenticated request slipping through)
 * would 401 instead of silently succeeding.
 */

export const E2E_FAKE_ACCESS_TOKEN = "e2e-fake-access-token";
export const E2E_CREATED_SPREADSHEET_ID = "e2e-fake-created-spreadsheet-id";
export const E2E_PICKED_SPREADSHEET_ID = "e2e-fake-picked-spreadsheet-id";
export const E2E_PICKED_SPREADSHEET_NAME = "Shared household planner";
export const E2E_USER = {
  displayName: "Feeder E2E",
  emailAddress: "e2e@example.com",
};

/**
 * A fake `google.accounts.oauth2` (Google Identity Services token client).
 * `requestAccessToken` always "succeeds" asynchronously with
 * `E2E_FAKE_ACCESS_TOKEN` — there is no interactive consent screen to drive
 * in a headless test, and the real flow's UI is Google's own, entirely
 * outside this app's control anyway (WP-10's contract is "request a token,
 * get a token back via the callback").
 */
const FAKE_GIS_SCRIPT = `(function () {
  window.google = window.google || {};
  window.google.accounts = window.google.accounts || {};
  window.google.accounts.oauth2 = {
    initTokenClient: function (config) {
      return {
        requestAccessToken: function () {
          setTimeout(function () {
            config.callback({ access_token: ${JSON.stringify(E2E_FAKE_ACCESS_TOKEN)}, expires_in: 3600 });
          }, 0);
        },
      };
    },
    revoke: function (_token, done) {
      setTimeout(done, 0);
    },
  };
})();`;

/**
 * A fake `gapi.load('picker', ...)` that defines a minimal
 * `google.picker` namespace good enough for `src/sheets/picker.ts`:
 * `PickerBuilder().addView(...).setOAuthToken(...).setDeveloperKey(...)
 * .setCallback(cb).build().setVisible(true)` immediately "picks" one fixed
 * fake spreadsheet — there is no real Google-hosted file chooser UI to
 * drive headlessly either.
 */
const FAKE_GAPI_SCRIPT = `(function () {
  window.gapi = window.gapi || {};
  window.gapi.load = function (_api, callback) {
    window.google = window.google || {};
    window.google.picker = window.google.picker || {
      ViewId: { SPREADSHEETS: "spreadsheets" },
      Action: { PICKED: "picked", CANCEL: "cancel" },
      DocsView: function () {
        return { setMimeTypes: function () { return this; } };
      },
      PickerBuilder: function () {
        var onPicked;
        return {
          addView: function () { return this; },
          setOAuthToken: function () { return this; },
          setDeveloperKey: function () { return this; },
          setCallback: function (fn) { onPicked = fn; return this; },
          build: function () {
            return {
              setVisible: function (visible) {
                if (visible && onPicked) {
                  setTimeout(function () {
                    onPicked({
                      action: "picked",
                      docs: [{ id: ${JSON.stringify(E2E_PICKED_SPREADSHEET_ID)}, name: ${JSON.stringify(E2E_PICKED_SPREADSHEET_NAME)} }],
                    });
                  }, 0);
                }
              },
            };
          },
        };
      },
    };
    setTimeout(callback, 0);
  };
})();`;

const googleScriptHandlers: HttpHandler[] = [
  http.get("https://accounts.google.com/gsi/client", () =>
    HttpResponse.text(FAKE_GIS_SCRIPT, { headers: { "Content-Type": "text/javascript" } }),
  ),
  http.get("https://apis.google.com/js/api.js", () =>
    HttpResponse.text(FAKE_GAPI_SCRIPT, { headers: { "Content-Type": "text/javascript" } }),
  ),
];

/** Drive's about.get (src/sheets/user-info.ts) — identifies the signed-in user without an `email`/`profile` scope. */
const driveAboutHandler: HttpHandler = http.get("https://www.googleapis.com/drive/v3/about", ({ request }) => {
  if (request.headers.get("authorization") !== `Bearer ${E2E_FAKE_ACCESS_TOKEN}`) {
    return HttpResponse.json({ error: { code: 401, message: "Invalid Credentials" } }, { status: 401 });
  }
  return HttpResponse.json({ user: E2E_USER });
});

const sheetsHandlers: HttpHandler[] = [
  createSpreadsheetCreationHandler(E2E_FAKE_ACCESS_TOKEN, (title) => ({
    spreadsheetId: E2E_CREATED_SPREADSHEET_ID,
    title,
  })),
  ...createSheetsApiHandlers({ spreadsheetId: E2E_CREATED_SPREADSHEET_ID, accessToken: E2E_FAKE_ACCESS_TOKEN }),
  // Not bootstrapped (a Picker pick opens an EXISTING workbook — this app
  // never writes to it as part of opening it), but present so a read
  // against it 200s with empty data rather than an unhandled-request throw.
  ...createSheetsApiHandlers({ spreadsheetId: E2E_PICKED_SPREADSHEET_ID, accessToken: E2E_FAKE_ACCESS_TOKEN }),
];

export const handlers: HttpHandler[] = [...googleScriptHandlers, driveAboutHandler, ...sheetsHandlers];
