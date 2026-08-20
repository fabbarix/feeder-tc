import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { axe } from "vitest-axe";
import { AppShell } from "./AppShell.tsx";
import { ToastProvider } from "./components/Toast/ToastProvider.tsx";

function renderShell(props: ComponentProps<typeof AppShell> = {}) {
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

describe("AppShell", () => {
  it("renders the primary nav with all six section links", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const label of ["Home", "Recipes", "Pantry", "Plan", "Shopping", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(nav).toBeInTheDocument();
  });

  it("shows placeholder slots by default", () => {
    renderShell();
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(screen.getByText("No workbook")).toBeInTheDocument();
  });

  it("renders injected slot content instead of the placeholders", () => {
    renderShell({
      authStatusSlot: <span>fabbari@gmail.com</span>,
      workbookSwitcherSlot: <span>Household workbook</span>,
    });
    expect(screen.getByText("fabbari@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("Household workbook")).toBeInTheDocument();
    expect(screen.queryByText("Signed out")).not.toBeInTheDocument();
  });

  it("has a skip link to the main landmark", () => {
    renderShell();
    const skipLink = screen.getByRole("link", { name: "Skip to content" });
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("has no axe violations", async () => {
    const { container } = renderShell();
    expect(await axe(container)).toHaveNoViolations();
  });
});
