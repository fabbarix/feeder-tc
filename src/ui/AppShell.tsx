import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { AuthStatusSlot } from "./slots/AuthStatusSlot.tsx";
import { WorkbookSwitcherSlot } from "./slots/WorkbookSwitcherSlot.tsx";
import { ToastViewport } from "./components/Toast/ToastViewport.tsx";
import "./AppShell.css";

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: string;
}

// Keep in sync with App.tsx's route list. Icons are decorative glyphs
// (aria-hidden) — the accessible name of each nav link is its label alone.
const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Home", icon: "🏠" },
  { to: "/recipes", label: "Recipes", icon: "📖" },
  { to: "/pantry", label: "Pantry", icon: "🥫" },
  { to: "/plan", label: "Plan", icon: "📅" },
  { to: "/shopping", label: "Shopping", icon: "🛒" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

export interface AppShellProps {
  /** Injected by WP-10 once real auth exists; defaults to the `AuthStatusSlot` placeholder. */
  readonly authStatusSlot?: ReactNode;
  /** Injected by WP-10 once the multi-workbook registry exists; defaults to the `WorkbookSwitcherSlot` placeholder. */
  readonly workbookSwitcherSlot?: ReactNode;
}

/**
 * App layout: header (brand + workbook switcher + auth status slots),
 * routed content, and a bottom tab bar sized for one-handed thumb reach
 * (WP-23's in-store mode is the reason nav lives at the bottom, not just a
 * top bar — see `AppShell.css`). Mounted once by the router in `App.tsx`;
 * feature routes render inside it via `<Outlet />`.
 */
export function AppShell({ authStatusSlot, workbookSwitcherSlot }: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-shell__header">
        <span className="app-shell__brand">Feeder</span>
        <div className="app-shell__slots">
          {workbookSwitcherSlot ?? <WorkbookSwitcherSlot />}
          {authStatusSlot ?? <AuthStatusSlot />}
        </div>
      </header>

      <main id="main-content" className="app-shell__main" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="app-shell__nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `app-shell__nav-item${isActive ? " app-shell__nav-item--active" : ""}`
            }
          >
            <span className="app-shell__nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="app-shell__nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <ToastViewport />
    </div>
  );
}
