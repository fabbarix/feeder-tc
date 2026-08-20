import { createHashRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./ui/AppShell";
import { Home } from "./routes/Home";
import { Recipes } from "./routes/Recipes";
import { Pantry } from "./routes/Pantry";
import { Plan } from "./routes/Plan";
import { Shopping } from "./routes/Shopping";
import { Settings } from "./routes/Settings";

// Hash routing only ("/#/..."): GitHub Pages serves static files and cannot
// rewrite paths for a client-side router, so a browser (History API) router
// would 404 on refresh/deep-link.
const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: "recipes", element: <Recipes /> },
      { path: "pantry", element: <Pantry /> },
      { path: "plan", element: <Plan /> },
      { path: "shopping", element: <Shopping /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
