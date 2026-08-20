import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { AuthStatusSlot } from "./slots/AuthStatusSlot.tsx";
import { WorkbookSwitcherSlot } from "./slots/WorkbookSwitcherSlot.tsx";
import { ToastViewport } from "./components/Toast/ToastViewport.tsx";
import {
  BookOpen,
  CalendarBlank,
  CloudArrowUp,
  FileArrowUp,
  FolderOpen,
  GearSix,
  GoogleLogo,
  House,
  Package,
  ShoppingCart,
  SignOut,
  WifiSlash,
  type IconComponent,
} from "./icons.ts";
import styles from "./AppShell.module.css";

/**
 * Shell gating state (product-owner requirement, folded into WP-15b as
 * UI_DESIGN.md §12). Signing in is not sufficient — the app is useless
 * without a workbook (DESIGN.md §1) — so this is three states, not two
 * booleans, specifically so the compiler forces every case to be handled
 * (see the `switch` in `renderGate` below).
 */
export type ShellState =
  | { readonly kind: "signed-out" }
  | { readonly kind: "no-workbook" }
  | { readonly kind: "ready" };

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: IconComponent;
}

// Keep in sync with App.tsx's route list. Icons are decorative
// (aria-hidden) — the accessible name of each nav link is its label alone.
// Phosphor's weight prop gives the active/inactive state from the SAME icon
// (fill vs regular, UI_DESIGN.md §9) instead of two mismatched icon sets.
const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/recipes", label: "Recipes", icon: BookOpen },
  { to: "/pantry", label: "Pantry", icon: Package },
  { to: "/plan", label: "Plan", icon: CalendarBlank },
  { to: "/shopping", label: "Shopping", icon: ShoppingCart },
  { to: "/settings", label: "Settings", icon: GearSix },
];

export interface AppShellProps {
  readonly state: ShellState;
  /** Intent leaves via callbacks (UI_DESIGN.md §7) — AppShell never calls auth or the Sheets API itself; a container (App.tsx today, WP-20's real auth wiring later) supplies these. */
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
  readonly onCreateWorkbook: () => void;
  readonly onPickWorkbook: () => void;
  /** Sync state (UI_DESIGN.md §8) — read by the container and passed down as props; AppShell never imports the Outbox. */
  readonly offline?: boolean;
  readonly pendingCount?: number;
  /** Injected by WP-10 once real auth exists; defaults to the `AuthStatusSlot` placeholder. Rendered only in the "ready" state. */
  readonly authStatusSlot?: ReactNode;
  /** Injected by WP-10 once the multi-workbook registry exists; defaults to the `WorkbookSwitcherSlot` placeholder. Rendered only in the "ready" state. */
  readonly workbookSwitcherSlot?: ReactNode;
}

/**
 * App layout: header, gated main content, bottom tab bar sized for
 * one-handed thumb reach (WP-23's in-store mode), toast surface. Mounted
 * once by the router (`App.tsx`); feature routes render inside it via
 * `<Outlet />` — but ONLY in the "ready" state (UI_DESIGN.md §12): a cold
 * deep link to any path while signed out must show the signed-out screen,
 * not route content behind a hidden nav, so the gate lives here at the
 * point `<Outlet />` would otherwise render, not just around the nav links.
 */
export function AppShell({
  state,
  onSignIn,
  onSignOut,
  onCreateWorkbook,
  onPickWorkbook,
  offline = false,
  pendingCount = 0,
  authStatusSlot,
  workbookSwitcherSlot,
}: AppShellProps) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <span className={styles.brand}>Feeder</span>
        {state.kind === "ready" ? (
          <div className={styles.slots}>
            {workbookSwitcherSlot ?? <WorkbookSwitcherSlot />}
            {authStatusSlot ?? <AuthStatusSlot />}
            <button type="button" className={styles.signOutButton} onClick={onSignOut}>
              <SignOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>
        ) : null}
      </header>

      {state.kind === "ready" && (offline || pendingCount > 0) ? (
        <div className={styles.syncBanner} role="status" aria-live="polite">
          {offline ? <WifiSlash size={16} aria-hidden="true" /> : <CloudArrowUp size={16} aria-hidden="true" />}
          <span>
            {offline ? "You're offline." : "Back online."}
            {pendingCount > 0
              ? ` ${pendingCount} ${pendingCount === 1 ? "change" : "changes"} waiting to sync.`
              : ""}
          </span>
        </div>
      ) : null}

      {/*
       * Nav renders BEFORE <main> in the DOM (UI_DESIGN.md §13 "Desktop"):
       * at ≥768px it's `position: static` (an ordinary in-flow bar under the
       * header), so DOM order IS visual order there — rendering it after a
       * full-height <main> put it at the bottom of the page on desktop, the
       * actual §13 bug (not the CSS, which was already `position: fixed`
       * only below 768px). On mobile this has no visual effect: `position:
       * fixed` takes it out of flow regardless of DOM order. It does not
       * regress keyboard order either — the skip link (first in the DOM)
       * already exists specifically so a keyboard user can bypass nav
       * repetition and land on <main> directly.
       */}
      {state.kind === "ready" ? (
        <nav className={styles.nav} aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `${styles.navItem}${isActive ? ` ${styles.navItemActive}` : ""}`}
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    size={22}
                    weight={isActive ? "fill" : "regular"}
                    aria-hidden="true"
                    className={styles.navIcon}
                  />
                  <span className={styles.navLabel}>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      ) : null}

      <main id="main-content" className={styles.main} tabIndex={-1}>
        <div className={styles.mainMeasure}>
          {renderGate(state, { onSignIn, onCreateWorkbook, onPickWorkbook, onSignOut })}
        </div>
      </main>

      <ToastViewport />
    </div>
  );
}

interface GateHandlers {
  readonly onSignIn: () => void;
  readonly onCreateWorkbook: () => void;
  readonly onPickWorkbook: () => void;
  readonly onSignOut: () => void;
}

function renderGate(state: ShellState, handlers: GateHandlers): ReactNode {
  switch (state.kind) {
    case "signed-out":
      return <SignedOutScreen onSignIn={handlers.onSignIn} />;
    case "no-workbook":
      return (
        <NoWorkbookScreen
          onCreateWorkbook={handlers.onCreateWorkbook}
          onPickWorkbook={handlers.onPickWorkbook}
          onSignOut={handlers.onSignOut}
        />
      );
    case "ready":
      return <Outlet />;
    default: {
      // Exhaustiveness check: a fourth ShellState variant fails the build here.
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function SignedOutScreen({ onSignIn }: { readonly onSignIn: () => void }) {
  return (
    <section className={styles.gate}>
      <h1>Feeder</h1>
      <p className={styles.gateDescription}>
        Plan your household&rsquo;s meals, track what&rsquo;s in the pantry, and shop for only what you actually
        need.
      </p>
      <button type="button" className={styles.primaryAction} onClick={onSignIn}>
        <GoogleLogo size={20} aria-hidden="true" />
        Sign in with Google
      </button>
    </section>
  );
}

function NoWorkbookScreen({
  onCreateWorkbook,
  onPickWorkbook,
  onSignOut,
}: {
  readonly onCreateWorkbook: () => void;
  readonly onPickWorkbook: () => void;
  readonly onSignOut: () => void;
}) {
  return (
    <section className={styles.gate}>
      <h1>Feeder</h1>
      <p className={styles.gateDescription}>
        Create a new meal planner workbook, or open one a household member already shared with you.
      </p>
      <div className={styles.gateActions}>
        <button type="button" className={styles.primaryAction} onClick={onCreateWorkbook}>
          <FileArrowUp size={20} aria-hidden="true" />
          Create new meal planner
        </button>
        <button type="button" className={styles.secondaryAction} onClick={onPickWorkbook}>
          <FolderOpen size={20} aria-hidden="true" />
          Open existing…
        </button>
      </div>
      <button type="button" className={styles.signOutLink} onClick={onSignOut}>
        <SignOut size={16} aria-hidden="true" />
        Sign out
      </button>
    </section>
  );
}
