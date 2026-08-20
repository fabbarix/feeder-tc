import { useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { DismissButton, FocusScope, useButton, useOverlay } from "react-aria";
import { AuthStatusSlot } from "./slots/AuthStatusSlot.tsx";
import { WorkbookSwitcherSlot } from "./slots/WorkbookSwitcherSlot.tsx";
import { ToastViewport } from "./components/Toast/ToastViewport.tsx";
import { UpdatePrompt } from "./components/UpdatePrompt.tsx";
import { Mark } from "./Mark.tsx";
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
  Table,
  WifiSlash,
  type IconComponent,
} from "./icons.ts";
import styles from "./AppShell.module.css";

/** The signed-in user's identity, as shown in the header (UI_DESIGN.md §12). Sourced from whatever WP-20's auth wiring exposes — a Google ID/Drive-about lookup, never a broadened OAuth scope. */
export interface ShellUser {
  readonly name: string;
  readonly email: string;
  readonly pictureUrl?: string;
}

/**
 * Shell gating state (product-owner requirement, folded into WP-15b as
 * UI_DESIGN.md §12, amended 2026-08-20). Signing in is not sufficient — the
 * app is useless without a workbook (DESIGN.md §1) — so this is three
 * states, not two booleans, specifically so the compiler forces every case
 * to be handled (see the `switch`/narrowing below). The signed-in variants
 * carry the user: the header has nowhere else to get one from, and a
 * hardcoded fallback that renders regardless of state is worse than no
 * fallback — it looks correct and is wrong (see `renderHeaderRight`).
 */
export type ShellState =
  | { readonly kind: "signed-out" }
  | { readonly kind: "no-workbook"; readonly user: ShellUser }
  | { readonly kind: "ready"; readonly user: ShellUser; readonly workbookName: string };

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: IconComponent;
}

// Keep in sync with App.tsx's route list. Icons are decorative
// (aria-hidden) — the accessible name of each nav link is its label alone.
// Icons render on the mobile bottom tab bar only (CSS hides them at
// >=768px, UI_DESIGN.md §13 "one bar" revision) — Phosphor's weight prop
// still gives active/inactive state from the SAME icon there (fill vs
// regular, §9).
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
  /** Intent leaves via callbacks (UI_DESIGN.md §7) — AppShell never calls auth or the Sheets API itself; a container (App.tsx's real `createGoogleAuth` wiring) supplies these. */
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
  readonly onCreateWorkbook: () => void;
  readonly onPickWorkbook: () => void;
  /** Sync state (UI_DESIGN.md §8) — read by the container and passed down as props; AppShell never imports the Outbox. */
  readonly offline?: boolean;
  readonly pendingCount?: number;
  /**
   * WP-24 service-worker update seam (`src/pwa/update.ts`) — again read by
   * the container and passed down as props/callbacks; AppShell never imports
   * `src/pwa` itself (UI_DESIGN.md §7). `onApplyUpdate` must only ever be
   * wired to a call to `applyUpdate()` triggered by this prompt's own
   * button, never automatically — see `UpdatePrompt`'s doc comment.
   */
  readonly updateAvailable?: boolean;
  readonly onApplyUpdate?: () => void;
  /** Overrides the default auth-status rendering entirely (rare — most callers let AppShell derive it from `state.user`). */
  readonly authStatusSlot?: ReactNode;
  /** Overrides the default workbook-switcher rendering entirely (rare — most callers let AppShell derive it from `state.workbookName`). */
  readonly workbookSwitcherSlot?: ReactNode;
}

/**
 * App layout: one full-bleed header bar (brand mark, primary nav inline at
 * >=768px, workbook chip + avatar), gated main content, a mobile-only fixed
 * bottom tab bar, toast surface. Mounted once by the router (`App.tsx`);
 * feature routes render inside it via `<Outlet />` — but ONLY in the
 * "ready" state (UI_DESIGN.md §12): a cold deep link to any path while
 * signed out must show the signed-out screen, not route content behind a
 * hidden nav, so the gate lives here at the point `<Outlet />` would
 * otherwise render, not just around the nav links.
 */
export function AppShell({
  state,
  onSignIn,
  onSignOut,
  onCreateWorkbook,
  onPickWorkbook,
  offline = false,
  pendingCount = 0,
  updateAvailable = false,
  onApplyUpdate,
  authStatusSlot,
  workbookSwitcherSlot,
}: AppShellProps) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      {/*
       * ONE full-bleed bar (UI_DESIGN.md §13, amended 2026-08-20 after the
       * owner compared the deployed shell to the approved mockup): brand
       * mark, primary nav and the workbook/avatar controls all live in this
       * single <header>, with the nav landmark nested inside it. At >=768px
       * `.nav` is `position: static` and flows inline right of the mark,
       * producing one ~56px bar; below that it's `position: fixed` to the
       * viewport bottom regardless of where it sits in the DOM, so nesting
       * it here has no effect on the mobile tab bar.
       *
       * The bar itself is full-bleed — background/border reach both edges
       * of the viewport at any width. Owner-reported regression
       * (2026-08-20): a leftover `#root { max-width: 1126px }` from the
       * WP-01 scaffold used to cap the whole shell (nav included) into a
       * narrow centred column. `#root`'s max-width is gone (src/index.css);
       * `.headerInner`/`.navInner` below are what now supply a measure,
       * scoped to just this bar's own contents, matching `.mainMeasure`.
       */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Mark />
          {state.kind === "ready" ? (
            <nav className={styles.nav} aria-label="Primary">
              <div className={styles.navInner}>
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
              </div>
            </nav>
          ) : null}
          <div className={styles.headerRight}>
            {renderHeaderRight(state, onSignOut, authStatusSlot, workbookSwitcherSlot)}
          </div>
        </div>
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

      <main id="main-content" className={styles.main} tabIndex={-1}>
        <div className={styles.mainMeasure}>
          {renderGate(state, { onSignIn, onCreateWorkbook, onPickWorkbook })}
        </div>
      </main>

      {/*
       * Not gated on ShellState (unlike the sync banner above): a stale
       * build can sit waiting behind ANY screen, including signed-out —
       * nothing about "a new deploy exists" depends on being signed in or
       * having a workbook open, so the prompt must be reachable there too.
       */}
      {updateAvailable && onApplyUpdate ? <UpdatePrompt onReload={onApplyUpdate} /> : null}

      <ToastViewport />
    </div>
  );
}

/**
 * The header's right-hand controls derive entirely from `ShellState` — no
 * state-blind placeholders (UI_DESIGN.md §12). The first version rendered
 * `AuthStatusSlot`/`WorkbookSwitcherSlot` with a hardcoded "Signed out" /
 * "No workbook" whenever no slot was injected, regardless of state, so
 * `no-workbook` could show "Signed out" in the header while the body
 * offered "Sign out". Narrowing on `state.kind` here (rather than a
 * `signedIn` boolean) is what makes `state.user` statically available in
 * both remaining branches — a boolean would throw that link away.
 *
 * There is no standalone "Sign out" text in the bar (owner-reported,
 * comparing the deployed shell to the mockup) — it lives in the avatar's
 * own menu (`UserMenu` below) instead of a second visible control.
 */
function renderHeaderRight(
  state: ShellState,
  onSignOut: () => void,
  authStatusSlot: ReactNode | undefined,
  workbookSwitcherSlot: ReactNode | undefined,
): ReactNode {
  if (state.kind === "signed-out") {
    // No sign-out action anywhere when signed out — offering to sign out of
    // nothing is the tell that the header isn't reading state.
    return null;
  }
  return (
    <>
      {state.kind === "ready"
        ? (workbookSwitcherSlot ?? (
            <WorkbookSwitcherSlot>
              <WorkbookChip name={state.workbookName} />
            </WorkbookSwitcherSlot>
          ))
        : null}
      {authStatusSlot ?? (
        <AuthStatusSlot>
          <UserMenu user={state.user} onSignOut={onSignOut} />
        </AuthStatusSlot>
      )}
    </>
  );
}

function WorkbookChip({ name }: { readonly name: string }) {
  return (
    <span className={styles.workbookChip}>
      <Table size={14} aria-hidden="true" />
      <span className={styles.workbookChipName}>{name}</span>
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  const combined = (first + last).toUpperCase();
  return combined === "" ? "?" : combined;
}

/** Picture, or initials when `pictureUrl` is absent — never the word "Signed out" (UI_DESIGN.md §12). */
function Avatar({ user }: { readonly user: ShellUser }) {
  return user.pictureUrl ? (
    <img
      src={user.pictureUrl}
      alt=""
      width={28}
      height={28}
      className={styles.avatar}
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className={styles.avatarInitials} aria-hidden="true">
      {initials(user.name)}
    </span>
  );
}

/**
 * The avatar is a menu trigger (owner-reported, 2026-08-20): the mockup has
 * no standalone "Sign out" text in the bar, so sign-out (and the signed-in
 * email, for confirmation) live behind the avatar instead. Built on
 * `useButton` + `useOverlay` + `FocusScope` (react-aria) — the same
 * dismiss/focus-containment substrate as `SelectSheet`/`ConfirmDialog`, not
 * a native `<select>` or `window.confirm` (UI_DESIGN.md §5).
 */
function UserMenu({ user, onSignOut }: { readonly user: ShellUser; readonly onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  function close(): void {
    setOpen(false);
  }

  const { buttonProps } = useButton({ onPress: () => setOpen((current) => !current) }, triggerRef);
  const { overlayProps } = useOverlay(
    { isOpen: open, onClose: close, isDismissable: true, shouldCloseOnBlur: true },
    overlayRef,
  );

  return (
    <span className={styles.userMenuRoot}>
      <button
        {...buttonProps}
        ref={triggerRef}
        type="button"
        className={styles.avatarButton}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Avatar user={user} />
        <span className="visually-hidden">{`Account menu for ${user.name}`}</span>
      </button>
      {open ? (
        // No `role="menu"`/`"menuitem"` here: ARIA's menu role requires
        // every direct child to itself be a menuitem (axe's
        // aria-required-children caught exactly this when the static email
        // text sat alongside one) — this is a plain popover with a status
        // line and one action, not a full ARIA menu widget with roving
        // tabindex/arrow-key semantics. FocusScope + DismissButton already
        // supply the containment/dismiss behaviour that matters here.
        <FocusScope contain restoreFocus autoFocus>
          <div {...overlayProps} ref={overlayRef} className={styles.userMenu}>
            <DismissButton onDismiss={close} />
            <span className={styles.userMenuEmail}>{user.email}</span>
            <button
              type="button"
              className={styles.userMenuSignOut}
              onClick={() => {
                close();
                onSignOut();
              }}
            >
              <SignOut size={16} aria-hidden="true" />
              Sign out
            </button>
            <DismissButton onDismiss={close} />
          </div>
        </FocusScope>
      ) : null}
    </span>
  );
}

interface GateHandlers {
  readonly onSignIn: () => void;
  readonly onCreateWorkbook: () => void;
  readonly onPickWorkbook: () => void;
}

function renderGate(state: ShellState, handlers: GateHandlers): ReactNode {
  switch (state.kind) {
    case "signed-out":
      return <SignedOutScreen onSignIn={handlers.onSignIn} />;
    case "no-workbook":
      return <NoWorkbookScreen onCreateWorkbook={handlers.onCreateWorkbook} onPickWorkbook={handlers.onPickWorkbook} />;
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
}: {
  readonly onCreateWorkbook: () => void;
  readonly onPickWorkbook: () => void;
}) {
  return (
    <section className={styles.gate}>
      <h1>Get started</h1>
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
    </section>
  );
}
