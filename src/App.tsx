import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./ui/AppShell";
import { Home } from "./routes/Home";
import { Recipes } from "./routes/Recipes";
import { Pantry } from "./routes/Pantry";
import { Plan } from "./routes/Plan";
import { Shopping } from "./routes/Shopping";
import { Settings } from "./routes/Settings";

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
      element: <AppShell />,
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
  return <RouterProvider router={router} />;
}
