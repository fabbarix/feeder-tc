import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell, type ShellUser } from "./ui/AppShell";
import { ThemeProvider } from "./ui/theme/ThemeProvider";
import { ToastProvider } from "./ui/components/Toast/ToastProvider";
import { useToast } from "./ui/components/Toast/useToast.ts";
import { Home } from "./routes/Home";
import { Recipes } from "./routes/Recipes";
import { RecipeEditor } from "./routes/RecipeEditor.tsx";
import { Ingredients } from "./routes/Ingredients.tsx";
import { IngredientEditor } from "./routes/IngredientEditor.tsx";
import { Pantry } from "./routes/Pantry";
import { Plan } from "./routes/Plan";
import { Shopping } from "./routes/Shopping";
import { Settings } from "./routes/Settings";
import { env } from "./env.ts";
import { systemClock, createSeededRng } from "./domain/index.ts";
import {
  createGoogleAuth,
  createGooglePickerLauncher,
  createGoogleSheetsTransport,
  createSheetsWorkbookStore,
  createWorkbook,
  createWorkbookRegistry,
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

  useEffect(() => auth.subscribe(setAuthState), [auth]);

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
      refreshActiveWorkbook();
      const transport = createGoogleSheetsTransport({ spreadsheetId: created.id, auth });
      const store = createSheetsWorkbookStore(transport);
      await bootstrapWorkbook(transport, store);
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

  const workbookContextValue = useMemo<WorkbookContextValue | undefined>(() => {
    if (!activeWorkbook) return undefined;
    const transport = createGoogleSheetsTransport({ spreadsheetId: activeWorkbook.id, auth });
    return { store: createSheetsWorkbookStore(transport), clock: systemClock, rng };
  }, [activeWorkbook, auth, rng]);

  return (
    <WorkbookContext.Provider value={workbookContextValue}>
      <AppShell
        state={shellState}
        onSignIn={() => void handleSignIn()}
        onSignOut={() => void handleSignOut()}
        onCreateWorkbook={() => void handleCreateWorkbook()}
        onPickWorkbook={() => void handlePickWorkbook()}
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
        { index: true, element: <Home /> },
        { path: "recipes", element: <Recipes /> },
        { path: "recipes/ingredients", element: <Ingredients /> },
        { path: "recipes/ingredients/new", element: <IngredientEditor /> },
        { path: "recipes/ingredients/:ingredientId", element: <IngredientEditor /> },
        { path: "recipes/new", element: <RecipeEditor /> },
        { path: "recipes/:recipeId", element: <RecipeEditor /> },
        { path: "pantry", element: <Pantry /> },
        { path: "plan", element: <Plan /> },
        { path: "shopping", element: <Shopping /> },
        { path: "settings", element: <Settings /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

export function App() {
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
