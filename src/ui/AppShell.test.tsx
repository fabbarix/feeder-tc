import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { axe } from "vitest-axe";
import { AppShell, type AppShellProps, type ShellState, type ShellUser } from "./AppShell.tsx";
import { ToastProvider } from "./components/Toast/ToastProvider.tsx";

function noop() {
  /* no-op */
}

function renderShell(overrides: Partial<AppShellProps> = {}) {
  const props: AppShellProps = {
    state: { kind: "signed-out" },
    onSignIn: noop,
    onSignOut: noop,
    onCreateWorkbook: noop,
    onPickWorkbook: noop,
    ...overrides,
  };
  const router = createMemoryRouter(
    [{ path: "/", element: <AppShell {...props} />, children: [{ index: true, element: <p>Home content</p> }] }],
    { initialEntries: ["/"] },
  );
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
}

const USER: ShellUser = { name: "Fabio Torchetti", email: "fabbari@gmail.com" };
const NO_WORKBOOK: ShellState = { kind: "no-workbook", user: USER };
const READY: ShellState = { kind: "ready", user: USER, workbookName: "Household planner" };

describe("AppShell — signed-out state (UI_DESIGN.md §12)", () => {
  it("shows only the sign-in action — no nav, no route content, no account menu, no user identity", () => {
    renderShell({ state: { kind: "signed-out" } });
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByText("Home content")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /account menu/i })).not.toBeInTheDocument();
    expect(screen.queryByText(USER.name)).not.toBeInTheDocument();
    // The wordmark is the gate's page title, not chrome — it must still appear once (as the h1).
    expect(screen.getByRole("heading", { name: "Feeder" })).toBeInTheDocument();
  });

  it("calls onSignIn when the sign-in button is pressed", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    renderShell({ state: { kind: "signed-out" }, onSignIn });
    await user.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("has no axe violations", async () => {
    const { container } = renderShell({ state: { kind: "signed-out" } });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("AppShell — no-workbook state", () => {
  it("shows create/open actions and an account menu trigger — but no workbook chip, no nav, no route content", () => {
    renderShell({ state: NO_WORKBOOK });
    expect(screen.getByRole("button", { name: /create new meal planner/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open existing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /account menu/i })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByText("Home content")).not.toBeInTheDocument();
    // No workbook yet — no chip.
    expect(screen.queryByText("Household planner")).not.toBeInTheDocument();
  });

  it("has no standalone 'Sign out' text visible in the bar — it lives in the account menu", () => {
    renderShell({ state: NO_WORKBOOK });
    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Signed out")).not.toBeInTheDocument();
    expect(screen.queryByText("No workbook")).not.toBeInTheDocument();
  });

  it("falls back to initials on the avatar when pictureUrl is absent", () => {
    renderShell({ state: NO_WORKBOOK });
    expect(screen.getByText("FT")).toBeInTheDocument();
  });

  it("opens the account menu on click, showing the email and a sign-out action, and calls onSignOut", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    renderShell({ state: NO_WORKBOOK, onSignOut });

    const trigger = screen.getByRole("button", { name: /account menu/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    expect(screen.getByText(USER.email)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("calls onCreateWorkbook / onPickWorkbook", async () => {
    const user = userEvent.setup();
    const onCreateWorkbook = vi.fn();
    const onPickWorkbook = vi.fn();
    renderShell({ state: NO_WORKBOOK, onCreateWorkbook, onPickWorkbook });

    await user.click(screen.getByRole("button", { name: /create new meal planner/i }));
    expect(onCreateWorkbook).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: /open existing/i }));
    expect(onPickWorkbook).toHaveBeenCalledOnce();
  });

  it("has no axe violations", async () => {
    const { container } = renderShell({ state: NO_WORKBOOK });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("AppShell — ready state", () => {
  it("renders the primary nav with all six section links and the route content", () => {
    renderShell({ state: READY });
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const label of ["Home", "Recipes", "Pantry", "Plan", "Shopping", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(nav).toBeInTheDocument();
    expect(screen.getByText("Home content")).toBeInTheDocument();
  });

  it("shows the active workbook's name in a chip", () => {
    renderShell({ state: READY });
    expect(screen.getByText("Household planner")).toBeInTheDocument();
    expect(screen.queryByText("No workbook")).not.toBeInTheDocument();
  });

  it("renders injected slot content instead of the derived defaults", () => {
    renderShell({
      state: READY,
      authStatusSlot: <span>custom-auth-status</span>,
      workbookSwitcherSlot: <span>custom-workbook-switcher</span>,
    });
    expect(screen.getByText("custom-auth-status")).toBeInTheDocument();
    expect(screen.getByText("custom-workbook-switcher")).toBeInTheDocument();
    expect(screen.queryByText("Household planner")).not.toBeInTheDocument();
  });

  it("signs out via the account menu", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    renderShell({ state: READY, onSignOut });
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("hides the sync banner when online with nothing pending", () => {
    renderShell({ state: READY, offline: false, pendingCount: 0 });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows an offline + pending-count banner with aria-live=polite", () => {
    renderShell({ state: READY, offline: true, pendingCount: 3 });
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner).toHaveTextContent(/offline/i);
    expect(banner).toHaveTextContent(/3 changes waiting to sync/i);
  });

  it("has a skip link to the main landmark", () => {
    renderShell({ state: READY });
    const skipLink = screen.getByRole("link", { name: "Skip to content" });
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("has no axe violations", async () => {
    const { container } = renderShell({ state: READY });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with the account menu open", async () => {
    const user = userEvent.setup();
    const { container } = renderShell({ state: READY });
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
