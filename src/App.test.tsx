import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// `App` reads `import.meta.env` (via `missingEnvVars`/`env.ts`) at render
// time, so each scenario stubs the vars it needs and re-imports the module
// fresh — a module-level `import { App }` would freeze whichever env was
// present the first time this file's imports ran.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("App — VITE_GOOGLE_* absent (STATUS.md known debt, WP-31)", () => {
  it("renders an informative screen, not a blank page, when both vars are unset", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "");
    vi.resetModules();
    const { App } = await import("./App.tsx");
    const { container } = render(<App />);

    // The specific, actionable message — names what's missing and how to
    // fix it (UI_DESIGN.md §10's "no developer text ever reaches a user"
    // bar applies here too: this must read as a real screen, not a stack
    // trace or a stub).
    expect(screen.getByText(/feeder isn't configured/i)).toBeInTheDocument();
    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.getByText(/VITE_GOOGLE_API_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/\.env\.local\.example/)).toBeInTheDocument();

    // Never a blank page: something other than an empty root actually mounted.
    expect(container.textContent?.trim().length).toBeGreaterThan(0);

    // Never the ordinary signed-out shell either — that would mean the
    // Google wiring got constructed after all and the config-missing gate
    // didn't actually short-circuit it.
    expect(screen.queryByRole("button", { name: /sign in with google/i })).not.toBeInTheDocument();
  });

  it("names only the one var that's actually unset", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "a-real-client-id");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "");
    vi.resetModules();
    const { App } = await import("./App.tsx");
    render(<App />);

    expect(screen.getByText(/feeder isn't configured/i)).toBeInTheDocument();
    expect(screen.getByText(/VITE_GOOGLE_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByText(/VITE_GOOGLE_CLIENT_ID/)).not.toBeInTheDocument();
  });
});

describe("App — VITE_GOOGLE_* present", () => {
  it("renders the ordinary signed-out shell instead of the config-missing screen", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "a-real-client-id");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "a-real-api-key");
    vi.resetModules();
    const { App } = await import("./App.tsx");
    render(<App />);

    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.queryByText(/feeder isn't configured/i)).not.toBeInTheDocument();
  });
});
