import { NavLink, Outlet } from "react-router-dom";

// Minimal nav shell so the six routes are reachable and E2E-navigable.
// WP-15 replaces this with the real layout + component kit.
const NAV_ITEMS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/", label: "Home" },
  { to: "/recipes", label: "Recipes" },
  { to: "/pantry", label: "Pantry" },
  { to: "/plan", label: "Plan" },
  { to: "/shopping", label: "Shopping" },
  { to: "/settings", label: "Settings" },
];

export function AppShell() {
  return (
    <div className="app-shell">
      <nav aria-label="Primary">
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.to === "/"}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
