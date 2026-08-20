import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { axe } from "vitest-axe";
import { AppShell, type AppShellProps, type ShellState } from "./AppShell.tsx";
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

const READY: ShellState = { kind: "ready" };

describe("AppShell — signed-out state (UI_DESIGN.md §12)", () => {
  it("shows only the sign-in action — no nav, no route content, no workbook switcher", () => {
    renderShell({ state: { kind: "signed-out" } });
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByText("Home content")).not.toBeInTheDocument();
    expect(screen.queryByText("No workbook")).not.toBeInTheDocument();
    expect(screen.queryByText("Signed out")).not.toBeInTheDocument();
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
  it("shows create/open actions and sign-out, but still no nav or route content", () => {
    renderShell({ state: { kind: "no-workbook" } });
    expect(screen.getByRole("button", { name: /create new meal planner/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open existing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByText("Home content")).not.toBeInTheDocument();
  });

  it("calls onCreateWorkbook / onPickWorkbook / onSignOut", async () => {
    const user = userEvent.setup();
    const onCreateWorkbook = vi.fn();
    const onPickWorkbook = vi.fn();
    const onSignOut = vi.fn();
    renderShell({ state: { kind: "no-workbook" }, onCreateWorkbook, onPickWorkbook, onSignOut });

    await user.click(screen.getByRole("button", { name: /create new meal planner/i }));
    expect(onCreateWorkbook).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: /open existing/i }));
    expect(onPickWorkbook).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("has no axe violations", async () => {
    const { container } = renderShell({ state: { kind: "no-workbook" } });
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

  it("shows placeholder slots by default", () => {
    renderShell({ state: READY });
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(screen.getByText("No workbook")).toBeInTheDocument();
  });

  it("renders injected slot content instead of the placeholders", () => {
    renderShell({
      state: READY,
      authStatusSlot: <span>fabbari@gmail.com</span>,
      workbookSwitcherSlot: <span>Household workbook</span>,
    });
    expect(screen.getByText("fabbari@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("Household workbook")).toBeInTheDocument();
    expect(screen.queryByText("Signed out")).not.toBeInTheDocument();
  });

  it("calls onSignOut from the header sign-out button", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    renderShell({ state: READY, onSignOut });
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
});
