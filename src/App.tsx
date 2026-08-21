import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell, type ShellUser } from "./ui/AppShell";
import { ThemeProvider } from "./ui/theme/ThemeProvider";
import { ToastProvider } from "./ui/components/Toast/ToastProvider";
import { useToast } from "./ui/components/Toast/useToast.ts";
import { Skeleton } from "./ui/components/Skeleton.tsx";
import { Home } from "./routes/Home";
import { Shopping } from "./routes/Shopping";
import { env, missingEnvVars } from "./env.ts";
import { ConfigMissingScreen } from "./ui/ConfigMissingScreen.tsx";
import { systemClock, createSeededRng, type Outbox } from "./domain/index.ts";
import {
  createGoogleAuth,
  createGooglePickerLauncher,
  createGoogleSheetsTransport,
  createSheetsWorkbookStore,
  createWorkbook,
  createWorkbookRegistry,
  ensureWorkbookSchema,
  fetchAuthenticatedUser,
  pickWorkbook,
  bootstrapWorkbook,
  type GoogleAuth,
  type AuthState,
} from "./sheets/index.ts";
import type { WorkbookRegistry, WorkbookRegistryEntry } from "./sheets/registry.ts";
import type { PickerLauncher } from "./sheets/picker.ts";
import { deriveShellState } from "./shell-state.ts";
import { WorkbookContext, type WorkbookContextValue } from "./workbook-context.ts";
import {
  createLocalStorageOutbox,
  createBrowserConnectivityMonitor,
  createOutboxSyncController,
} from "./sync/index.ts";
import { createPwaUpdateWatcher } from "./pwa/update.ts";
import { warmBarcodeDecoderIfNeeded } from "./scan/warm-wasm-decoder.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Route-level code splitting (WP-VC3) — the bundle was 720 kB raw / 215 kB
// gzip, well past Vite's 500 kB warning, on an app whose brief is explicitly
// "works on a low-end phone on a supermarket connection" (HANDOVER.md §1).
// The shell, Home and Shopping stay in the eager, initial chunk — Shopping
// especially, since it's the in-store screen a shopper opens the app FOR.
// The brief specifically calls out the recipe editor, ingredient editor,
// planner and pantry as not needing to be in the initial chunk; every OTHER
// route is, by the same "shell + Home + Shopping is the hot path" logic,
// equally not part of it — Recipes/Ingredients (browse), a recipe's read
// view, and Settings are all visited less often per session than Home or
// Shopping, so they move to their own lazily-fetched chunks too, requested
// only when their route is actually navigated to. `Suspense`'s fallback is
// the kit's own `Skeleton` (UI_DESIGN.md §10) — never a blank flash while
// the chunk downloads.
//
// `vite-plugin-pwa`'s `generateSW` mode (vite.config.ts) builds its precache
// manifest FROM the build's own output files, after this split happens — so
// every lazy chunk below is still precached automatically, same as before;
// nothing here needs to also touch vite.config.ts's PWA config. Verified by
// `npm run build`'s own "precache N entries" line (more chunks than before
// this change) and e2e/wp-24-sw-offline.spec.ts, unchanged, still passing.
const Recipes = lazy(() => import("./routes/Recipes.tsx").then((m) => ({ default: m.Recipes })));
const RecipeDetail = lazy(() => import("./routes/RecipeDetail.tsx").then((m) => ({ default: m.RecipeDetail })));
const RecipeEditor = lazy(() => import("./routes/RecipeEditor.tsx").then((m) => ({ default: m.RecipeEditor })));
const Ingredients = lazy(() => import("./routes/Ingredients.tsx").then((m) => ({ default: m.Ingredients })));
const IngredientEditor = lazy(() =>
  import("./routes/IngredientEditor.tsx").then((m) => ({ default: m.IngredientEditor })),
);
const Pantry = lazy(() => import("./routes/Pantry.tsx").then((m) => ({ default: m.Pantry })));
const PantryItem = lazy(() => import("./routes/PantryItem.tsx").then((m) => ({ default: m.PantryItem })));
const Plan = lazy(() => import("./routes/Plan.tsx").then((m) => ({ default: m.Plan })));
const Settings = lazy(() => import("./routes/Settings.tsx").then((m) => ({ default: m.Settings })));
// M6 (DESIGN_PRODUCTS.md §1): the scanner + product editor. Lazy for the same
// reason as every route below, PLUS a harder requirement — its own decoder
// (src/scan/useBarcodeScanner.ts) must lazily `import()` a WASM fallback
// (src/scan/wasm-decoder.ts) only when BarcodeDetector is absent, and that
// fallback must never even be a candidate for the INITIAL chunk. Keeping the
// whole Scan route out of the eager shell bundle is the first of two layers
// of code-splitting that guarantees that (see wasm-decoder.ts's own header
// for the second).
const Scan = lazy(() => import("./routes/scan/Scan.tsx").then((m) => ({ default: m.Scan })));

/** Suspense fallback for a lazily-loaded route — matches the multi-`Skeleton` loading shape every route's own data-loading state already uses (e.g. Shopping.tsx, Plan.tsx). */
function RouteFallback() {
  return (
    <section>
      <Skeleton height="1.8rem" width="35%" />
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </section>
  );
}

/** Wraps a lazily-loaded route element in one shared `<Suspense>`/`RouteFallback` pair, so each router entry below stays a one-liner. */
function lazyRoute(element: ReactElement): ReactElement {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

/** Default title for a freshly created workbook — human-readable, editable later like any spreadsheet title (invariant 6). */
const DEFAULT_WORKBOOK_TITLE = "Feeder meal planner";

/**
 * Real auth/registry/Picker wiring for `AppShell`'s three-state `ShellState`
 * (UI_DESIGN.md §12, WP-20). Constructed once, lazily, on this component's
 * first render — never at module import time — so `npm test`/`npm run
 * build` stay green with `VITE_GOOGLE_CLIENT_ID`/`VITE_GOOGLE_API_KEY`
 * unset (they are only wired into the production build job — see
 * src/env.ts), and so no Google API call happens before a user gesture:
 * `createGoogleAuth`/`createGooglePickerLauncher` themselves are pure
 * object construction — no script load, no network call, nothing touches
 * `window.google` until `signIn()`/the Picker's `open()` runs, both of
 * which only ever fire from a button's `onClick` below.
 */
function createGoogleWiring(): { auth: GoogleAuth; registry: WorkbookRegistry; pickerLauncher: PickerLauncher } {
  return {
    auth: createGoogleAuth(env.googleClientId),
    registry: createWorkbookRegistry(window.localStorage),
    pickerLauncher: createGooglePickerLauncher(env.googleApiKey),
  };
}

function ShellContainer() {
  const [{ auth, registry, pickerLauncher }] = useState(createGoogleWiring);
  // A single app-lifetime Rng seeded from real entropy — production's
  // counterpart to the deterministic seeded Rng domain tests use (design
  // requirement 6: engines take Rng injected, never call Math.random()
  // themselves; something outside src/domain has to be that source).
  const [rng] = useState(() => createSeededRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0));
  const { showToast } = useToast();

  const [authState, setAuthState] = useState<AuthState>(() => auth.state());
  const [user, setUser] = useState<ShellUser | undefined>(undefined);
  const [activeWorkbook, setActiveWorkbook] = useState<WorkbookRegistryEntry | undefined>(() => registry.getActive());

  // WP-24: sync state for AppShell's offline banner (UI_DESIGN.md §8) — a
  // single app-lifetime connectivity monitor (offline-ness isn't scoped to
  // one workbook), read here and passed down as props/callbacks so
  // `src/ui/**` never imports `src/sync/**` directly (UI_DESIGN.md §7,
  // eslint-enforced).
  const [connectivity] = useState(() => createBrowserConnectivityMonitor());
  const [offline, setOffline] = useState(() => !connectivity.isOnline());
  useEffect(() => connectivity.subscribe((online) => setOffline(!online)), [connectivity]);

  const [pendingCount, setPendingCount] = useState(0);

  // One Outbox per active workbook (invariant 9 — offline writes are events
  // appended via the outbox, never in-place edits), rebuilt whenever the
  // active workbook changes. `refreshPendingCount` re-reads it rather than
  // trusting a locally-tracked delta, so this container's count can never
  // drift from what is actually durably queued (same "always re-read"
  // discipline `createLocalStorageOutbox` itself follows — see its header
  // comment).
  const outbox = useMemo<Outbox | undefined>(() => {
    if (!activeWorkbook) return undefined;
    return createLocalStorageOutbox(activeWorkbook.id);
  }, [activeWorkbook]);

  // `pendingCount`/`loading`-style state is only ever set from a promise's
  // own resolution, never synchronously in the effect body itself (matches
  // Recipes.tsx's fetch pattern, and react-hooks' set-state-in-effect rule)
  // — the `useState(0)` above already covers "nothing queued yet".
  const refreshPendingCount = useCallback(() => {
    void (outbox ? outbox.pending() : Promise.resolve([])).then((pending) => setPendingCount(pending.length));
  }, [outbox]);

  useEffect(() => {
    let cancelled = false;
    void (outbox ? outbox.pending() : Promise.resolve([])).then((pending) => {
      if (!cancelled) setPendingCount(pending.length);
    });
    return () => {
      cancelled = true;
    };
  }, [outbox]);

  // A route (WP-23's shopping list, once it exists) enqueues through THIS
  // wrapper, via `useWorkbookContext().outbox` — never the raw Outbox —
  // purely so every enqueue/acknowledge/clear also refreshes the banner's
  // count. The controller below is given the same wrapper as its outbox, so
  // a flush's `acknowledge` calls refresh it too.
  const countedOutbox = useMemo<Outbox | undefined>(() => {
    if (!outbox) return undefined;
    return {
      async enqueue(event) {
        await outbox.enqueue(event);
        refreshPendingCount();
      },
      pending: () => outbox.pending(),
      async acknowledge(eventId) {
        await outbox.acknowledge(eventId);
        refreshPendingCount();
      },
      async clear() {
        await outbox.clear();
        refreshPendingCount();
      },
    };
  }, [outbox, refreshPendingCount]);

  // WP-24 update prompt (`src/pwa/update.ts`): constructed once, lazily —
  // `createPwaUpdateWatcher`'s default parameter reads `navigator.serviceWorker`
  // at call time, so this must not run at module-import time either, same
  // reasoning as `createGoogleWiring` above.
  const [pwaUpdate] = useState(() => createPwaUpdateWatcher());
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => pwaUpdate.onUpdateAvailable(() => setUpdateAvailable(true)), [pwaUpdate]);
  // Only ever called from AppShell's own "Reload" button (a user gesture) —
  // never automatically. See `PwaUpdateApi.applyUpdate`'s doc comment for why.
  const handleApplyUpdate = useCallback(() => {
    void pwaUpdate.applyUpdate();
  }, [pwaUpdate]);

  useEffect(() => auth.subscribe(setAuthState), [auth]);

  // Session restore on load. Without this a page refresh — and every cold
  // start of the installed PWA, which is far more frequent — dropped the
  // in-closure token and forced a full consent round trip. `restore()` makes
  // no Google call at all unless this browser has signed in before, and
  // renders no UI either way, so a `false` needs no handling: the shell
  // simply stays on its signed-out state and shows the sign-in button.
  useEffect(() => {
    void auth.restore();
  }, [auth]);

  const refreshActiveWorkbook = useCallback(() => {
    setActiveWorkbook(registry.getActive());
  }, [registry]);

  const handleSignIn = useCallback(async () => {
    try {
      await auth.signIn();
      const token = await auth.getAccessToken();
      const authenticatedUser = await fetchAuthenticatedUser(token);
      setUser(authenticatedUser);
    } catch (err) {
      // Keep authState/user consistent (deriveShellState treats a missing
      // user as signed-out regardless of the auth machine's own state) —
      // sign back out rather than leaving a half-signed-in dead end the
      // header can't render sensibly.
      await auth.signOut().catch(() => undefined);
      setUser(undefined);
      showToast({ variant: "error", title: "Sign-in failed", description: messageOf(err) });
    }
  }, [auth, showToast]);

  const handleSignOut = useCallback(async () => {
    try {
      await auth.signOut();
    } finally {
      // The workbook registry is deliberately NOT cleared here — it's a
      // bookmark (spreadsheet id + name), not a credential (registry.ts),
      // so the same workbook is offered again on the next sign-in without
      // re-running Picker. Only the access token is ever discarded.
      setUser(undefined);
    }
  }, [auth]);

  const handleCreateWorkbook = useCallback(async () => {
    showToast({
      variant: "info",
      title: "Setting up your workbook…",
      description: "Creating the spreadsheet and writing the seeded ingredient catalog.",
      durationMs: 4000,
    });
    try {
      const created = await createWorkbook(DEFAULT_WORKBOOK_TITLE, auth, registry);
      const transport = createGoogleSheetsTransport({ spreadsheetId: created.id, auth });
      const store = createSheetsWorkbookStore(transport);
      await bootstrapWorkbook(transport, store);
      // Only now does `registry.getActive()` get mirrored into React state
      // (flipping `ShellState` to "ready" and mounting routes, WP-21 fixed
      // 2026-08-20): `createWorkbook` above already persisted the workbook
      // to the registry and set it active, but the workbook itself isn't
      // actually usable until bootstrap finishes writing the Meta row,
      // Settings and the seeded catalog. Calling this earlier let a route
      // mount (and e.g. `Meta.read()`) mid-bootstrap, racing an empty/
      // partially-written workbook — WP-21's pantry route was the first to
      // read `Meta` at mount and hit it as a hard "not bootstrapped
      // correctly" error, but the race existed for every "ready" route.
      refreshActiveWorkbook();
      showToast({
        variant: "success",
        title: "Workbook ready",
        description: `Created "${created.name}" with the seeded ingredient catalog.`,
        durationMs: 5000,
      });
    } catch (err) {
      showToast({ variant: "error", title: "Couldn't create the workbook", description: messageOf(err) });
    }
  }, [auth, registry, refreshActiveWorkbook, showToast]);

  const handlePickWorkbook = useCallback(async () => {
    try {
      const picked = await pickWorkbook(pickerLauncher, auth, registry);
      if (picked) {
        refreshActiveWorkbook();
        showToast({
          variant: "success",
          title: "Workbook opened",
          description: `Switched to "${picked.name}".`,
          durationMs: 5000,
        });
      }
    } catch (err) {
      showToast({ variant: "error", title: "Couldn't open the picker", description: messageOf(err) });
    }
  }, [auth, pickerLauncher, registry, refreshActiveWorkbook, showToast]);

  const shellState = deriveShellState(authState, user, activeWorkbook);

  // Coordinator follow-up on PR #32: warm the barcode WASM fallback as soon
  // as the app is USABLE — signed in, workbook loaded — rather than waiting
  // for the user to open /scan, which may already be too late (the
  // household is often already at the shop by their first scan). This is
  // a fire-and-forget, idle-scheduled, best-effort background fetch;
  // `warmBarcodeDecoderIfNeeded` itself no-ops on browsers with
  // `BarcodeDetector`, while offline, or on a detectable save-data/2G
  // connection — see that module for the full policy and why the
  // connection check is inert on Safari (the very browser this exists
  // for — see that module's own doc comment).
  useEffect(() => {
    if (shellState.kind === "ready") warmBarcodeDecoderIfNeeded();
  }, [shellState.kind]);

  const workbookContextValue = useMemo<WorkbookContextValue | undefined>(() => {
    if (!activeWorkbook || !countedOutbox) return undefined;
    const transport = createGoogleSheetsTransport({ spreadsheetId: activeWorkbook.id, auth });
    // Both WP-21's workbookId (per-workbook SnapshotStore/Outbox keying) and
    // WP-24-UI's outbox (routes enqueue writes through it) — additive, not
    // competing.
    return {
      store: createSheetsWorkbookStore(transport),
      clock: systemClock,
      rng,
      ...(user ? { user } : {}),
      workbookId: activeWorkbook.id,
      outbox: countedOutbox,
    };
  }, [activeWorkbook, auth, rng, countedOutbox, user]);

  // Bring a workbook that predates the current schema up to date whenever it
  // is OPENED, not only when it is created — a spreadsheet the Picker points
  // at (or one restored from the registry on reload) may be missing a tab a
  // later work package added (M6-A's Products/PriceObservations, WP-PHOTO's
  // Photos), which is exactly the production bug this fix exists to close
  // (the scan route's `store.products.readAll()` 400ing on such a workbook).
  // `readRange`/`batchRead` (transport.ts) already tolerate a missing tab on
  // their own, so this is a background repair, not a correctness dependency:
  // deliberately fire-and-forget, never awaited before `shellState` goes
  // "ready" — a slow or offline migration attempt must not block first
  // paint or gate any route mounting. `ensureWorkbookSchema` itself is cheap
  // when there is nothing to fix (one "list this spreadsheet's tabs" call,
  // no writes), so this costs at most one extra request per workbook open.
  useEffect(() => {
    if (!activeWorkbook) return;
    const spreadsheetId = activeWorkbook.id;
    const transport = createGoogleSheetsTransport({ spreadsheetId, auth });
    let cancelled = false;
    void ensureWorkbookSchema({ spreadsheetId, auth, transport }).catch((err: unknown) => {
      // Best-effort only. A failed attempt (offline, a transient API error)
      // leaves the workbook exactly as tolerant as it already was — every
      // reader still treats a missing tab as empty, and the next write to
      // that sheet self-heals it via `ensureHeader`/`appendRows`'s own
      // fallback (workbook-store.ts / transport.ts) regardless. Nothing here
      // should ever surface a toast for a repair the user didn't ask for.
      if (!cancelled) console.warn("Workbook schema migration failed", err);
    });
    return () => {
      cancelled = true;
    };
  }, [activeWorkbook, auth]);

  // Flush automatically on reconnect (and once immediately, if already
  // online) whenever there is both a workbook to flush into and an outbox to
  // flush from — restarted whenever either changes (e.g. switching
  // workbooks). `countedOutbox` (not the raw `outbox`) so a flush's own
  // `acknowledge` calls refresh the banner's pending count too.
  useEffect(() => {
    if (!workbookContextValue || !countedOutbox) return;
    const controller = createOutboxSyncController({
      outbox: countedOutbox,
      workbookStore: workbookContextValue.store,
      connectivity,
    });
    return controller.start();
  }, [workbookContextValue, countedOutbox, connectivity]);

  return (
    <WorkbookContext.Provider value={workbookContextValue}>
      <AppShell
        state={shellState}
        onSignIn={() => void handleSignIn()}
        onSignOut={() => void handleSignOut()}
        onCreateWorkbook={() => void handleCreateWorkbook()}
        onPickWorkbook={() => void handlePickWorkbook()}
        offline={offline}
        pendingCount={pendingCount}
        updateAvailable={updateAvailable}
        onApplyUpdate={handleApplyUpdate}
      />
    </WorkbookContext.Provider>
  );
}

// Real History API routing ("/recipes/12"), not hash routing.
//
// GitHub Pages cannot rewrite paths, so a deep link like /recipes/12 has no
// matching file on disk. The standard fix is a 404.html that is a byte-for-byte
// copy of index.html: Pages serves it for any unmatched path, the app boots,
// and the router reads location.pathname normally. vite.config.ts emits that
// copy at build time — see the emit-spa-fallback plugin there.
//
// The one caveat: a cold deep link is served with HTTP status 404 even though
// the page renders correctly. That is invisible to users and irrelevant for a
// private, auth-gated household app, and once WP-24's service worker is
// installed navigations are served from the precache with a 200 anyway.
//
// basename comes from Vite's BASE_URL so the same build works whether the site
// is served from https://fabbarix.github.io/feeder-tc/ or from the root of a
// custom domain — only vite.config.ts's `base` changes.
const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <ShellContainer />,
      children: [
        // Home and Shopping are the hot path (see the code-splitting doc
        // comment above) — the only two feature routes still eagerly
        // bundled into the shell's own chunk.
        { index: true, element: <Home /> },
        { path: "shopping", element: <Shopping /> },
        // Everything else is a separately-fetched lazy chunk.
        { path: "recipes", element: lazyRoute(<Recipes />) },
        { path: "recipes/ingredients", element: lazyRoute(<Ingredients />) },
        { path: "recipes/ingredients/new", element: lazyRoute(<IngredientEditor />) },
        { path: "recipes/ingredients/:ingredientId", element: lazyRoute(<IngredientEditor />) },
        { path: "recipes/new", element: lazyRoute(<RecipeEditor />) },
        { path: "recipes/:recipeId", element: lazyRoute(<RecipeDetail />) },
        { path: "recipes/:recipeId/edit", element: lazyRoute(<RecipeEditor />) },
        { path: "pantry", element: lazyRoute(<Pantry />) },
        { path: "pantry/:ingredientId", element: lazyRoute(<PantryItem />) },
        { path: "plan", element: lazyRoute(<Plan />) },
        { path: "settings", element: lazyRoute(<Settings />) },
        { path: "scan", element: lazyRoute(<Scan />) },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

export function App() {
  // Checked BEFORE anything below is constructed — `missingEnvVars` never
  // throws (unlike `env.googleClientId`/`env.googleApiKey`), so this is the
  // one env read safe to do unconditionally on every render. A non-empty
  // result means `ShellContainer`'s `useState(createGoogleWiring)` would hit
  // one of those throwing getters on its first render, which — uncaught,
  // mid-render — unmounts the whole tree to a blank page (see
  // `ConfigMissingScreen`'s doc comment, and STATUS.md "Known debt"). Render
  // an informative screen instead, and never construct the router/shell at
  // all: nothing below this branch needs the missing vars, so nothing below
  // it runs.
  const missing = missingEnvVars();
  if (missing.length > 0) {
    return (
      <ThemeProvider>
        <ConfigMissingScreen missing={missing} />
      </ThemeProvider>
    );
  }

  // ToastProvider wraps the router (not just AppShell) so a toast fired from
  // any route survives navigation and errors — see
  // src/ui/components/Toast/ToastProvider.tsx. ThemeProvider wraps
  // everything (UI_DESIGN.md §2) so data-theme/--accent-hue stay in sync
  // regardless of which route is mounted.
  return (
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>
  );
}
