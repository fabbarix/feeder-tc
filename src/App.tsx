import { useEffect, useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell, type ShellState } from "./ui/AppShell";
import { ThemeProvider } from "./ui/theme/ThemeProvider";
import { ToastProvider } from "./ui/components/Toast/ToastProvider";
import { Home } from "./routes/Home";
import { Recipes } from "./routes/Recipes";
import { Pantry } from "./routes/Pantry";
import { Plan } from "./routes/Plan";
import { Shopping } from "./routes/Shopping";
import { Settings } from "./routes/Settings";

// Session-scoped placeholder for the real sign-in / workbook state
// (UI_DESIGN.md §12). WP-10's auth (src/sheets/auth.ts) and WP-11's
// workbook registry exist, but wiring AppShell to them — and to the Picker —
// is WP-20's job, not WP-15b's (component-kit revision). AppShell itself is
// prop-driven and imports nothing from src/sheets/ (enforced by the
// no-restricted-imports rule in eslint.config.js); this container is the
// ONLY thing standing in for that real wiring today, and it makes zero
// network calls (no Google API, not even mocked) — purely local state, kept
// in sessionStorage (not localStorage — this is a session-scoped stand-in,
// not a cache the app should trust across browser restarts) so the shell
// stays exercisable end-to-end across page navigations within one browser
// session/E2E run. WP-20 deletes this component and replaces it with real
// `createGoogleAuth`-driven state plus Picker-driven workbook selection.
const DEMO_STATE_KEY = "feeder:demo-shell-state";

function loadDemoStateKind(): ShellState["kind"] {
  try {
    const raw = window.sessionStorage.getItem(DEMO_STATE_KEY);
    if (raw === "signed-out" || raw === "no-workbook" || raw === "ready") return raw;
  } catch {
    // sessionStorage unavailable — fall through to the default below.
  }
  return "signed-out";
}

function ShellContainer() {
  const [stateKind, setStateKind] = useState<ShellState["kind"]>(loadDemoStateKind);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(DEMO_STATE_KEY, stateKind);
    } catch {
      // Best-effort only; in-memory state still works for the rest of this session.
    }
  }, [stateKind]);

  return (
    <AppShell
      state={{ kind: stateKind }}
      onSignIn={() => setStateKind("no-workbook")}
      onSignOut={() => setStateKind("signed-out")}
      onCreateWorkbook={() => setStateKind("ready")}
      onPickWorkbook={() => setStateKind("ready")}
    />
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
        { path: "recipes/:recipeId", element: <Recipes /> },
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
