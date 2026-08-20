import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ThemeProvider } from "./ThemeProvider.tsx";
import { ThemeControl } from "./ThemeControl.tsx";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

function renderControl() {
  return render(
    <ThemeProvider>
      <ThemeControl />
    </ThemeProvider>,
  );
}

describe("ThemeControl", () => {
  it("renders a System/Light/Dark segmented control defaulting to System", () => {
    renderControl();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  });

  it("renders a grid of ~12 hue swatches, not an <input type=range>", () => {
    renderControl();
    const swatches = screen.getAllByRole("button", { name: /^Hue \d+ degrees$/ });
    expect(swatches.length).toBeGreaterThanOrEqual(12);
    expect(document.querySelector('input[type="range"]')).not.toBeInTheDocument();
  });

  it("selecting Dark flips data-theme, selecting a swatch changes the pressed hue", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    // The default hue (156, the brand green) is deliberately not one of the
    // 12 evenly-spaced swatches, so none is pressed until the user picks one.
    await user.click(screen.getByRole("button", { name: "Hue 210 degrees" }));
    expect(screen.getByRole("button", { name: "Hue 210 degrees" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Hue 180 degrees" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Hue 60 degrees" }));
    expect(screen.getByRole("button", { name: "Hue 60 degrees" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Hue 210 degrees" })).toHaveAttribute("aria-pressed", "false");
  });

  it("has no axe violations", async () => {
    const { container } = renderControl();
    expect(await axe(container)).toHaveNoViolations();
  });
});
