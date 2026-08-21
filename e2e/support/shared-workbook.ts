import { http, HttpResponse, type HttpHandler } from "msw";
import { setupServer } from "msw/node";
import type { BrowserContext } from "@playwright/test";
import { createSheetsApiHandlers, createSpreadsheetCreationHandler } from "../../src/sheets/mocks/handlers.ts";
import { createGoogleSheetsTransport, createSheetsWorkbookStore, listSheetTitles } from "../../src/sheets/index.ts";
import type { WorkbookStore } from "../../src/domain/contracts.ts";
import type { WorkbookSheetName } from "../../src/domain/types.ts";

/**
 * WP-30's own mock backend for scenarios a single page's msw browser Service
 * Worker cannot model: two (or more) browser CONTEXTS need to see the SAME
 * in-memory workbook, and/or a test needs Node-side control over that
 * workbook (bumping `Meta.generation`, dropping requests to simulate a dead
 * connection) that no code running inside a page can reach.
 *
 * `src/mocks/handlers.ts` (msw/browser) can't do this even for two *pages*:
 * each page that runs `main.tsx` calls `setupWorker(...handlers)` itself,
 * which re-executes `createSheetsApiHandlers` and builds a BRAND NEW
 * `createFakeSheetsTransport()` closure — the Service Worker only forwards
 * intercepted requests to whichever page is currently controlling it and
 * resolves them there, it does not hold the fake state itself. Two pages
 * hitting "the same" mocked spreadsheet id therefore each get their own,
 * independent in-memory workbook — invisible to each other. Real household
 * members obviously don't have that problem (Sheets IS the shared state);
 * modelling "one workbook" for a test needs the fake state to live
 * somewhere both browser contexts can reach, which no in-page mock can be.
 *
 * The trick: `msw/node`'s `setupServer(...handlers).listen()` patches
 * `fetch` in THIS Node process (the Playwright test/worker process), not in
 * any browser. `BrowserContext.route()` handlers also run in this same Node
 * process. So a route handler that does `await fetch(request)` for a
 * matched Google-domain request gets resolved by the very same
 * `setupServer` instance — reusing `createSheetsApiHandlers` verbatim (byte
 * for byte the same A1-range parsing, missing-tab errors, and `addSheet`
 * dedupe every other spec's mock exercises) instead of a hand-rolled
 * reimplementation that could quietly drift from it.
 *
 * `context.route()` alone is NOT enough, though — this is the one
 * genuinely non-obvious gotcha here, worth reading even if you skip the
 * rest of this comment: empirically, `context.route()`/`page.route()` do
 * NOT reliably win over a page's own ACTIVE msw Service Worker for a real
 * cross-origin fetch once that worker is installed and controlling the
 * page (`VITE_ENABLE_MOCKS=true`, which every E2E project sets) — the two
 * race for the same request, and the Service Worker can still answer it
 * first. `bridgedPath()`'s `?e2e-no-mock-sw` query flag (read once, at
 * boot, by `src/main.tsx`) makes a page skip starting that worker entirely,
 * so this backend's `context.route()` is the ONLY interception in play —
 * no race, no double-mock. Any future E2E work that needs Node-side control
 * over a mocked request will hit this same race; route around it the same
 * way rather than rediscovering it.
 */

export const SHARED_ACCESS_TOKEN = "wp-30-shared-access-token";
export const SHARED_USER = { displayName: "Feeder E2E household", emailAddress: "e2e-household@example.com" };

/**
 * Every `page.goto()` (or `enterReadyShell`'s `path`) for a page whose
 * context has `SharedWorkbookBackend.install()`ed must go through this —
 * appends the query flag `src/main.tsx` reads, once, at boot, to skip
 * starting the msw browser Service Worker on that page load. `path` is
 * relative, per TESTING.md's own convention (a leading slash would resolve
 * against the origin and drop a future base path).
 */
export function bridgedPath(path = ""): string {
  return `${path}${path.includes("?") ? "&" : "?"}e2e-no-mock-sw=1`;
}

const GOOGLE_HOSTS = new Set([
  "sheets.googleapis.com",
  "www.googleapis.com",
  "accounts.google.com",
  "apis.google.com",
]);

/** Same fake token-client shape as `src/mocks/handlers.ts`'s FAKE_GIS_SCRIPT, parameterized so this module owns its own copy rather than reaching into that one's private constants. */
function fakeGisScript(token: string): string {
  return `(function () {
    window.google = window.google || {};
    window.google.accounts = window.google.accounts || {};
    window.google.accounts.oauth2 = {
      initTokenClient: function (config) {
        return {
          requestAccessToken: function () {
            setTimeout(function () { config.callback({ access_token: ${JSON.stringify(token)}, expires_in: 3600 }); }, 0);
          },
        };
      },
      revoke: function (_token, done) { setTimeout(done, 0); },
    };
  })();`;
}

/** Same fake Picker shape as `src/mocks/handlers.ts`'s FAKE_GAPI_SCRIPT, but with a CONFIGURABLE picked id/name — the point of this module: client B's "Open existing…" needs to hand back the exact workbook client A created. */
function fakePickerScript(pickedId: string, pickedName: string): string {
  return `(function () {
    window.gapi = window.gapi || {};
    window.gapi.load = function (_api, callback) {
      window.google = window.google || {};
      window.google.picker = window.google.picker || {
        ViewId: { SPREADSHEETS: "spreadsheets" },
        Action: { PICKED: "picked", CANCEL: "cancel" },
        DocsView: function () { return { setMimeTypes: function () { return this; } }; },
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
                      onPicked({ action: "picked", docs: [{ id: ${JSON.stringify(pickedId)}, name: ${JSON.stringify(pickedName)} }] });
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
}

export interface SharedWorkbookConfig {
  readonly spreadsheetId: string;
  /** Omit for "every current tab exists" (a normal workbook); pass a narrower list to model one created before the current schema (PR #36). */
  readonly existingSheets?: readonly WorkbookSheetName[];
  /** What "Open existing…" hands back — defaults to `spreadsheetId` itself, so a second client naturally opens the SAME workbook the first created/this backend was seeded with. */
  readonly pickedSpreadsheetId?: string;
  readonly pickedName?: string;
}

export interface SharedWorkbookBackend {
  /** A real `WorkbookStore`, wired to this backend's fake over the exact wire protocol the app itself uses — for Node-side setup/inspection: seeding rows before any client opens the workbook, or bumping `Meta.generation` exactly as a compaction job would. */
  readonly store: WorkbookStore;
  /** The current tab list, straight from the fake's own `spreadsheets.get` — lets a test prove a migration actually ran (a tab that didn't exist now does) instead of only inferring it from the UI not crashing. */
  listSheets(): Promise<readonly string[]>;
  /**
   * Routes every Google-domain request from this browser context through
   * this backend, so any number of contexts installed against the SAME
   * `SharedWorkbookBackend` instance share one in-memory workbook. Every
   * page navigated in that context MUST be loaded via `bridgedPath()` (below)
   * so it skips starting its own msw Service Worker — see this module's own
   * header comment. Returns a handle to simulate that context losing its
   * connection: while "down", every matched request is aborted the way a
   * real dropped connection would fail a `fetch`
   * (`route.abort("internetdisconnected")`) instead of being answered —
   * plain `context.setOffline()` cannot substitute for this, because it
   * only flips `navigator.onLine`/fires the browser's online/offline
   * events (which this backend's pages still get, same as any other page);
   * it does not make a `fetch()` this bridge would otherwise answer
   * actually fail.
   */
  install(context: BrowserContext): Promise<{ setNetworkDown(down: boolean): void }>;
  close(): void;
}

export function createSharedWorkbookBackend(config: SharedWorkbookConfig): SharedWorkbookBackend {
  const pickedId = config.pickedSpreadsheetId ?? config.spreadsheetId;
  const pickedName = config.pickedName ?? "Shared household planner";

  const driveAbout: HttpHandler = http.get("https://www.googleapis.com/drive/v3/about", ({ request }) => {
    if (request.headers.get("authorization") !== `Bearer ${SHARED_ACCESS_TOKEN}`) {
      return HttpResponse.json({ error: { code: 401, message: "Invalid Credentials" } }, { status: 401 });
    }
    return HttpResponse.json({ user: SHARED_USER });
  });

  const handlers: HttpHandler[] = [
    http.get("https://accounts.google.com/gsi/client", () =>
      HttpResponse.text(fakeGisScript(SHARED_ACCESS_TOKEN), { headers: { "Content-Type": "text/javascript" } }),
    ),
    http.get("https://apis.google.com/js/api.js", () =>
      HttpResponse.text(fakePickerScript(pickedId, pickedName), { headers: { "Content-Type": "text/javascript" } }),
    ),
    driveAbout,
    createSpreadsheetCreationHandler(SHARED_ACCESS_TOKEN, (title) => ({ spreadsheetId: config.spreadsheetId, title })),
    ...createSheetsApiHandlers({
      spreadsheetId: config.spreadsheetId,
      accessToken: SHARED_ACCESS_TOKEN,
      ...(config.existingSheets ? { existingSheets: config.existingSheets } : {}),
    }),
  ];

  const server = setupServer(...handlers);
  server.listen({ onUnhandledRequest: "error" });

  const transport = createGoogleSheetsTransport({
    spreadsheetId: config.spreadsheetId,
    auth: { getAccessToken: () => Promise.resolve(SHARED_ACCESS_TOKEN), invalidate: () => undefined },
  });
  const store = createSheetsWorkbookStore(transport);

  async function install(context: BrowserContext): Promise<{ setNetworkDown(down: boolean): void }> {
    let down = false;
    await context.route(
      (url) => GOOGLE_HOSTS.has(url.hostname),
      async (route) => {
        if (down) {
          await route.abort("internetdisconnected");
          return;
        }
        const req = route.request();
        const body = req.postDataBuffer();
        const init: RequestInit = { method: req.method(), headers: await req.allHeaders() };
        if (body && req.method() !== "GET" && req.method() !== "HEAD") {
          init.body = new Uint8Array(body);
        }
        const response = await fetch(req.url(), init);
        const buffer = Buffer.from(await response.arrayBuffer());
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          const lower = key.toLowerCase();
          if (lower === "content-encoding" || lower === "content-length") return;
          headers[key] = value;
        });
        await route.fulfill({ status: response.status, headers, body: buffer });
      },
    );
    return { setNetworkDown: (value: boolean) => (down = value) };
  }

  const auth = { getAccessToken: () => Promise.resolve(SHARED_ACCESS_TOKEN), invalidate: () => undefined };
  return {
    store,
    listSheets: () => listSheetTitles(config.spreadsheetId, { auth }),
    install,
    close: () => server.close(),
  };
}
