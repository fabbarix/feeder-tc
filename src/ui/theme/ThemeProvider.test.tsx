import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ThemeProvider } from "./ThemeProvider.tsx";
import { useTheme } from "./useTheme.ts";
import { STORAGE_KEY } from "./storage.ts";

type MediaListener = (event: MediaQueryListEvent) => void;

/** jsdom has no real `prefers-color-scheme` support — stub matchMedia so ThemeProvider's resolvedMode logic can be exercised deterministically in both directions. */
function mockMatchMedia(initiallyDark: boolean) {
  const listeners = new Set<MediaListener>();
  let matches = initiallyDark;
  const mql = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_type: string, cb: MediaListener) => listeners.add(cb),
    removeEventListener: (_type: string, cb: MediaListener) => listeners.delete(cb),
    // Legacy API some code paths may still probe for; unused here but keeps the stub shape honest.
    addListener: (cb: MediaListener) => listeners.add(cb),
    removeListener: (cb: MediaListener) => listeners.delete(cb),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return {
    setSystemDark(next: boolean) {
      matches = next;
      for (const cb of listeners) cb({ matches: next } as MediaQueryListEvent);
    },
  };
}

function Probe() {
  const { mode, hue, resolvedMode, setMode, setHue } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolvedMode}</span>
      <span data-testid="hue">{hue}</span>
      <button onClick={() => setMode("light")}>Light</button>
      <button onClick={() => setMode("dark")}>Dark</button>
      <button onClick={() => setMode("system")}>System</button>
      <button onClick={() => setHue(210)}>Blue hue</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("--accent-hue");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("--accent-hue");
  });

  it("defaults to system mode and the brand hue (156) with no data-theme attribute", () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("system");
    expect(screen.getByTestId("hue")).toHaveTextContent("156");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("system mode resolves to the OS preference and updates live on a change event", () => {
    const media = mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");

    act(() => media.setSystemDark(false));
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });

  it("THE GUARD, direction 1: explicit Light on a system-dark device overrides the media query", async () => {
    const user = userEvent.setup();
    mockMatchMedia(true); // device/OS is dark
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark"); // system default, unguarded so far

    await user.click(screen.getByRole("button", { name: "Light" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });

  it("THE GUARD, direction 2: explicit Dark on a system-light device overrides the media query", async () => {
    const user = userEvent.setup();
    mockMatchMedia(false); // device/OS is light
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");

    await user.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });

  it("returning to System removes data-theme and follows the OS again", async () => {
    const user = userEvent.setup();
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    await user.click(screen.getByRole("button", { name: "System" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });

  it("persists mode and hue TOGETHER under one localStorage key", async () => {
    const user = userEvent.setup();
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Dark" }));
    await user.click(screen.getByRole("button", { name: "Blue hue" }));

    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored).toEqual({ mode: "dark", hue: 210 });
  });

  it("has no axe violations", async () => {
    mockMatchMedia(false);
    const { container } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
